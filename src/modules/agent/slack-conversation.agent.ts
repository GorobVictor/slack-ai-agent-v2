import { Agent } from "agents";
import { Session, type SessionMessage } from "agents/experimental/memory/session";
import { WorkersAiAdapter } from "../../adapters/cloudflare/workers-ai.adapter";
import { ConsoleLoggerAdapter } from "../../adapters/console/console-logger.adapter";
import type { AiMessage, GenerateTextInput } from "../../ports/ai.port";
import { agentToolDefinitions, executeAgentTool } from "./agent.tools";
import type { RunAgentInput, RunAgentResult } from "./agent.types";

const DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_HISTORY_MESSAGES = 40;
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_CANDIDATE_LIMIT = SEARCH_RESULT_LIMIT * 3;

const SYSTEM_PROMPT = [
  "You are a concise AI assistant inside Slack.",
  "Answer clearly and directly.",
  "Use available Slack conversation history as context.",
  "Slack metadata in prior messages describes where each message came from.",
  "Do not reveal hidden chain-of-thought or internal reasoning."
].join(" ");

interface SlackConversationAgentState {
  activeThreadTs: string[];
}

type SlackContextScope =
  | { type: "thread"; threadTs: string }
  | { type: "channel" }
  | { type: "default" };

export class SlackConversationAgent extends Agent<Env, SlackConversationAgentState> {
  initialState: SlackConversationAgentState = {
    activeThreadTs: []
  };

  private readonly logger = new ConsoleLoggerAdapter();
  private readonly session = Session.create(this).withContext("memory", {
    description: "Important durable facts learned from this Slack conversation",
    maxTokens: 1100
  });

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    this.logger.info("slack_conversation_agent_started", {
      input
    });

    await upsertSessionMessage(this.session, buildUserSessionMessage(input));

    const shouldReply = this.shouldReply(input);
    if (!shouldReply) {
      const result: RunAgentResult = {
        shouldReply: false,
        toolCalls: []
      };

      this.logger.info("slack_conversation_agent_skipped_reply", {
        result
      });

      return result;
    }

    this.markActiveThread(input);

    const ai = new WorkersAiAdapter(this.env.AI, {
      id: this.env.AI_GATEWAY_ID,
      collectLogs: readBooleanBinding(this.env, "AI_GATEWAY_COLLECT_LOGS"),
      source: this.env.AI_GATEWAY_SOURCE
    });
    const request = await this.buildGenerateTextInput(input);

    this.logger.info("slack_conversation_agent_ai_first_request", {
      request
    });

    const firstResponse = await ai.generateText(request);
    this.logger.info("slack_conversation_agent_ai_first_response", {
      response: firstResponse
    });

    if (firstResponse.toolCalls.length === 0) {
      await upsertSessionMessage(
        this.session,
        buildAssistantSessionMessage(input, firstResponse.text)
      );

      const result: RunAgentResult = {
        shouldReply: true,
        text: firstResponse.text,
        ...(input.replyTarget ? { replyTarget: input.replyTarget } : {}),
        toolCalls: [],
        ...(firstResponse.logId ? { aiGatewayLogId: firstResponse.logId } : {})
      };

      this.logger.info("slack_conversation_agent_completed", {
        result
      });

      return result;
    }

    const toolResults = firstResponse.toolCalls.map((toolCall) => {
      this.logger.info("slack_conversation_agent_tool_call_started", {
        toolCall
      });

      const result = executeAgentTool(toolCall);
      this.logger.info("slack_conversation_agent_tool_call_completed", {
        toolCall,
        result
      });

      return result;
    });
    const followUpRequest: GenerateTextInput = {
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: firstResponse.text || "I need to call a tool before answering."
        },
        ...toolResults.map((result) => ({
          role: "tool" as const,
          tool_call_id: result.toolCallId,
          content: result.content
        }))
      ]
    };

    this.logger.info("slack_conversation_agent_ai_follow_up_request", {
      request: followUpRequest
    });

    const followUpResponse = await ai.generateText(followUpRequest);
    this.logger.info("slack_conversation_agent_ai_follow_up_response", {
      response: followUpResponse
    });

    await upsertSessionMessage(
      this.session,
      buildAssistantSessionMessage(input, followUpResponse.text)
    );

    const aiGatewayLogId = followUpResponse.logId ?? firstResponse.logId;
    const result: RunAgentResult = {
      shouldReply: true,
      text: followUpResponse.text,
      ...(input.replyTarget ? { replyTarget: input.replyTarget } : {}),
      toolCalls: firstResponse.toolCalls,
      ...(aiGatewayLogId ? { aiGatewayLogId } : {})
    };

    this.logger.info("slack_conversation_agent_completed", {
      result
    });

    return result;
  }

  private shouldReply(input: RunAgentInput): boolean {
    if (input.responseRequirement === "always") {
      return true;
    }

    if (input.responseRequirement === "never" || !input.threadTs) {
      return false;
    }

    return this.state.activeThreadTs.includes(input.threadTs);
  }

  private markActiveThread(input: RunAgentInput): void {
    const threadTs =
      input.replyTarget?.type === "thread" ? input.replyTarget.threadTs : input.threadTs;
    if (!threadTs || this.state.activeThreadTs.includes(threadTs)) {
      return;
    }

    this.setState({
      activeThreadTs: [...this.state.activeThreadTs, threadTs]
    });
  }

  private async buildGenerateTextInput(input: RunAgentInput): Promise<GenerateTextInput> {
    const contextScope = determineContextScope(input);
    const history = await this.session.getHistory();
    const recentMessages = historyToAiMessages(history, contextScope).slice(-MAX_HISTORY_MESSAGES);
    const searchContext = await this.buildSearchContext(input, contextScope);

    return {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: buildScopeSystemMessage(contextScope) },
        ...(searchContext ? [{ role: "system" as const, content: searchContext }] : []),
        ...recentMessages
      ],
      tools: agentToolDefinitions,
      metadata: buildMetadata(input)
    };
  }

  private async buildSearchContext(
    input: RunAgentInput,
    contextScope: SlackContextScope
  ): Promise<string | null> {
    if (!shouldSearchHistory(input.text)) {
      return null;
    }

    try {
      const searchLimit =
        contextScope.type === "thread" ? SEARCH_CANDIDATE_LIMIT : SEARCH_RESULT_LIMIT;
      const results = await this.session.search(input.text, { limit: searchLimit });
      const scopedResults = results
        .filter((result) => contentMatchesScope(result.content, contextScope))
        .slice(0, SEARCH_RESULT_LIMIT);

      if (scopedResults.length === 0) {
        return null;
      }

      return [
        "Relevant searchable Slack history for this request:",
        ...scopedResults.map(
          (result) => `- ${result.createdAt ?? "unknown time"} ${result.role}: ${result.content}`
        )
      ].join("\n");
    } catch (error: unknown) {
      this.logger.warn("slack_conversation_agent_search_failed", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return null;
    }
  }
}

async function upsertSessionMessage(session: Session, message: SessionMessage): Promise<void> {
  const existing = await session.getMessage(message.id);
  if (existing) {
    await session.updateMessage(message);
    return;
  }

  await session.appendMessage(message);
}

function buildUserSessionMessage(input: RunAgentInput): SessionMessage {
  return {
    id: `slack-user-${input.channelId ?? "unknown"}-${input.messageTs ?? crypto.randomUUID()}`,
    role: "user",
    parts: [{ type: "text", text: renderSlackMessageText(input.text, input, "user") }],
    ...(input.messageTs ? { createdAt: slackTsToDate(input.messageTs) } : {})
  };
}

function buildAssistantSessionMessage(input: RunAgentInput, text: string): SessionMessage {
  return {
    id: `slack-assistant-${input.channelId ?? "unknown"}-${crypto.randomUUID()}`,
    role: "assistant",
    parts: [{ type: "text", text: renderSlackMessageText(text, input, "assistant") }],
    createdAt: new Date()
  };
}

function renderSlackMessageText(
  text: string,
  input: RunAgentInput,
  speaker: "assistant" | "user"
): string {
  const threadTs = resolveEffectiveThreadTs(input) ?? "none";

  return [
    `[Slack metadata: speaker=${speaker}; user=${input.userId ?? "bot"}; channel=${input.channelId ?? "unknown"}; channelType=${input.channelType ?? "unknown"}; messageTs=${input.messageTs ?? "unknown"}; threadTs=${threadTs}; shouldReply=${input.responseRequirement}; replyTarget=${formatReplyTarget(input)}]`,
    text
  ].join("\n");
}

function formatReplyTarget(input: RunAgentInput): string {
  if (!input.replyTarget) {
    return "none";
  }

  return input.replyTarget.type === "thread"
    ? `thread:${input.replyTarget.threadTs}`
    : `message:${input.replyTarget.channelId}`;
}

function historyToAiMessages(
  history: SessionMessage[],
  contextScope: SlackContextScope
): AiMessage[] {
  return history.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const content = getSessionMessageText(message);
    if (!contentMatchesScope(content, contextScope)) {
      return [];
    }

    return content ? [{ role: message.role, content }] : [];
  });
}

function getSessionMessageText(message: SessionMessage): string {
  return message.parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function determineContextScope(input: RunAgentInput): SlackContextScope {
  if (input.channelType !== "im" && requestsWholeChannelContext(input.text)) {
    return { type: "channel" };
  }

  if (input.threadTs) {
    return { type: "thread", threadTs: input.threadTs };
  }

  if (input.channelType !== "im" && shouldSearchHistory(input.text)) {
    return { type: "channel" };
  }

  return { type: "default" };
}

function buildScopeSystemMessage(contextScope: SlackContextScope): string {
  if (contextScope.type === "thread") {
    return [
      `Current Slack context scope: thread ${contextScope.threadTs}.`,
      "Use only messages from this Slack thread as conversation context.",
      "Ignore other channel history unless the user explicitly asks for the whole channel."
    ].join(" ");
  }

  if (contextScope.type === "channel") {
    return [
      "Current Slack context scope: channel.",
      "Use the current channel history, including messages from its threads, when answering this request."
    ].join(" ");
  }

  return [
    "Current Slack context scope: narrow default.",
    "Use recent context only as needed, and do not summarize or pull in unrelated channel history unless explicitly requested."
  ].join(" ");
}

function contentMatchesScope(content: string, contextScope: SlackContextScope): boolean {
  if (contextScope.type !== "thread") {
    return true;
  }

  return (
    content.includes(`threadTs=${contextScope.threadTs}`) ||
    content.includes(`replyTarget=thread:${contextScope.threadTs}`)
  );
}

function requestsWholeChannelContext(text: string): boolean {
  return /whole\s+channel|entire\s+channel|all\s+threads|channel\s+(?:history|context|summary|recap)|summari[sz]e\s+(?:the\s+)?channel|summary\s+(?:of\s+)?(?:the\s+)?channel|весь\s+канал|всього\s+канал|усього\s+канал|по\s+всьому\s+канал|по\s+усьому\s+канал|по\s+канал|всі\s+тред|усі\s+тред|всіх\s+тред|усіх\s+тред/i.test(
    text
  );
}

function shouldSearchHistory(text: string): boolean {
  return /summari[sz]e|summary|today|earlier|previous|history|recap|підсум|просум|сьогодні|істор/i.test(
    text
  );
}

function slackTsToDate(value: string): Date {
  const milliseconds = Number.parseFloat(value) * 1000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date();
}

function buildMetadata(input: RunAgentInput): Record<string, string> {
  const threadTs = resolveEffectiveThreadTs(input);

  return {
    slackSessionKey: input.sessionKey,
    ...(input.userId ? { slackUserId: input.userId } : {}),
    ...(input.channelId ? { slackChannelId: input.channelId } : {}),
    ...(input.channelType ? { slackChannelType: input.channelType } : {}),
    ...(input.messageTs ? { slackMessageTs: input.messageTs } : {}),
    ...(threadTs ? { slackThreadTs: threadTs } : {})
  };
}

function resolveEffectiveThreadTs(input: RunAgentInput): string | undefined {
  return (
    input.threadTs ??
    (input.replyTarget?.type === "thread" ? input.replyTarget.threadTs : undefined)
  );
}

function readBooleanBinding(env: object, key: string): boolean {
  const record = env as Record<string, unknown>;
  const rawValue = record[key];

  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  return rawValue === "true";
}
