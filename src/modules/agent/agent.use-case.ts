import type { AiPort, GenerateTextInput } from "../../ports/ai.port";
import type { LoggerPort } from "../../ports/logger.port";
import { agentToolDefinitions, executeAgentTool } from "./agent.tools";
import type { RunAgentInput, RunAgentResult } from "./agent.types";

const DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

const SYSTEM_PROMPT = [
  "You are a concise AI assistant inside Slack.",
  "Answer clearly and directly.",
  "Use tools only when they are useful.",
  "Do not reveal hidden chain-of-thought or internal reasoning."
].join(" ");

export class AgentUseCase {
  constructor(
    private readonly ai: AiPort,
    private readonly logger: LoggerPort
  ) {}

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    this.logger.info("agent_use_case_started", {
      input
    });

    const firstRequest: GenerateTextInput = {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.text }
      ],
      tools: agentToolDefinitions,
      metadata: buildMetadata(input)
    };
    this.logger.info("agent_ai_first_request", {
      request: firstRequest
    });

    const firstResponse = await this.ai.generateText(firstRequest);
    this.logger.info("agent_ai_first_response", {
      response: firstResponse
    });

    if (firstResponse.toolCalls.length === 0) {
      const result: RunAgentResult = {
        text: firstResponse.text,
        toolCalls: [],
        ...(firstResponse.logId ? { aiGatewayLogId: firstResponse.logId } : {})
      };

      this.logger.info("agent_use_case_completed", {
        result
      });

      return result;
    }

    const toolResults = firstResponse.toolCalls.map((toolCall) => {
      this.logger.info("agent_tool_call_started", {
        toolCall
      });

      const result = executeAgentTool(toolCall);
      this.logger.info("agent_tool_call_completed", {
        toolCall,
        result
      });

      return result;
    });
    const followUpRequest: GenerateTextInput = {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.text },
        {
          role: "assistant",
          content: firstResponse.text || "I need to call a tool before answering."
        },
        ...toolResults.map((result) => ({
          role: "tool" as const,
          tool_call_id: result.toolCallId,
          content: result.content
        }))
      ],
      tools: agentToolDefinitions,
      metadata: buildMetadata(input)
    };
    this.logger.info("agent_ai_follow_up_request", {
      request: followUpRequest
    });

    const followUpResponse = await this.ai.generateText(followUpRequest);
    this.logger.info("agent_ai_follow_up_response", {
      response: followUpResponse
    });

    const aiGatewayLogId = followUpResponse.logId ?? firstResponse.logId;

    const result: RunAgentResult = {
      text: followUpResponse.text,
      toolCalls: firstResponse.toolCalls,
      ...(aiGatewayLogId ? { aiGatewayLogId } : {})
    };

    this.logger.info("agent_use_case_completed", {
      result
    });

    return result;
  }
}

function buildMetadata(input: RunAgentInput): Record<string, string> {
  return {
    ...(input.userId ? { slackUserId: input.userId } : {}),
    ...(input.channelId ? { slackChannelId: input.channelId } : {})
  };
}
