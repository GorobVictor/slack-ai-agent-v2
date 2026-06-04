import type { AiPort } from "../../ports/ai.port";
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
  constructor(private readonly ai: AiPort) {}

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    const firstResponse = await this.ai.generateText({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.text }
      ],
      tools: agentToolDefinitions,
      metadata: buildMetadata(input)
    });

    if (firstResponse.toolCalls.length === 0) {
      return {
        text: firstResponse.text,
        toolCalls: [],
        ...(firstResponse.logId ? { aiGatewayLogId: firstResponse.logId } : {})
      };
    }

    const toolResults = firstResponse.toolCalls.map(executeAgentTool);
    const followUpResponse = await this.ai.generateText({
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
    });

    const aiGatewayLogId = followUpResponse.logId ?? firstResponse.logId;

    return {
      text: followUpResponse.text,
      toolCalls: firstResponse.toolCalls,
      ...(aiGatewayLogId ? { aiGatewayLogId } : {})
    };
  }
}

function buildMetadata(input: RunAgentInput): Record<string, string> {
  return {
    ...(input.userId ? { slackUserId: input.userId } : {}),
    ...(input.channelId ? { slackChannelId: input.channelId } : {})
  };
}
