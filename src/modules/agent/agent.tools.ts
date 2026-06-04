import type { AiToolCall, AiToolDefinition } from "../../ports/ai.port";
import type { AgentToolExecutionResult } from "./agent.types";

export const agentToolDefinitions: AiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current ISO timestamp for time-sensitive Slack answers.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export function executeAgentTool(toolCall: AiToolCall): AgentToolExecutionResult {
  if (toolCall.name !== "get_current_time") {
    throw new Error(`Unsupported tool call: ${toolCall.name}`);
  }

  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: JSON.stringify({
      now: new Date().toISOString(),
    }),
  };
}
