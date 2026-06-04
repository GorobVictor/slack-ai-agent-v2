import type { AiToolCall } from "../../ports/ai.port";
import type { SlackReplyTarget, SlackResponseRequirement } from "../slack/slack-event-mapper";

export interface RunAgentInput {
  sessionKey: string;
  userId?: string;
  channelId?: string;
  channelType?: string;
  messageTs?: string;
  threadTs?: string;
  replyTarget?: SlackReplyTarget;
  responseRequirement: SlackResponseRequirement;
  text: string;
}

export interface RunAgentResult {
  shouldReply: boolean;
  text?: string;
  replyTarget?: SlackReplyTarget;
  toolCalls: AiToolCall[];
  aiGatewayLogId?: string;
}

export interface AgentToolExecutionResult {
  toolCallId: string;
  name: string;
  content: string;
}
