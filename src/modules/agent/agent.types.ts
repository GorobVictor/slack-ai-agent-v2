import type { AiToolCall } from "../../ports/ai.port";

export interface RunAgentInput {
  userId?: string;
  channelId?: string;
  channelType?: string;
  messageTs?: string;
  threadTs?: string;
  text: string;
}

export interface RunAgentResult {
  text: string;
  toolCalls: AiToolCall[];
  aiGatewayLogId?: string;
}

export interface AgentToolExecutionResult {
  toolCallId: string;
  name: string;
  content: string;
}
