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
    const history = await this.session.getHistory();
    const recentMessages = historyToAiMessages(history).slice(-MAX_HISTORY_MESSAGES);
    const searchContext = await this.buildSearchContext(input);

    return {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(searchContext ? [{ role: "system" as const, content: searchContext }] : []),
        ...recentMessages
      ],
      tools: agentToolDefinitions,
      metadata: buildMetadata(input)
    };
  }

  private async buildSearchContext(input: RunAgentInput): Promise<string | null> {
    if (!shouldSearchHistory(input.text)) {
      return null;
    }

    try {
      const results = await this.session.search(input.text, { limit: SEARCH_RESULT_LIMIT });
      if (results.length === 0) {
        return null;
      }

      return [
        "Relevant searchable Slack history for this request:",
        ...results.map(
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
  return [
    `[Slack metadata: speaker=${speaker}; user=${input.userId ?? "bot"}; channel=${input.channelId ?? "unknown"}; channelType=${input.channelType ?? "unknown"}; messageTs=${input.messageTs ?? "unknown"}; threadTs=${input.threadTs ?? "none"}; shouldReply=${input.responseRequirement}; replyTarget=${formatReplyTarget(input)}]`,
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

function historyToAiMessages(history: SessionMessage[]): AiMessage[] {
  return history.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const content = message.parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");

    return content ? [{ role: message.role, content }] : [];
  });
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
  return {
    slackSessionKey: input.sessionKey,
    ...(input.userId ? { slackUserId: input.userId } : {}),
    ...(input.channelId ? { slackChannelId: input.channelId } : {}),
    ...(input.channelType ? { slackChannelType: input.channelType } : {}),
    ...(input.messageTs ? { slackMessageTs: input.messageTs } : {}),
    ...(input.threadTs ? { slackThreadTs: input.threadTs } : {})
  };
}

function readBooleanBinding(env: object, key: string): boolean {
  const record = env as Record<string, unknown>;
  const rawValue = record[key];

  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  return rawValue === "true";
}
