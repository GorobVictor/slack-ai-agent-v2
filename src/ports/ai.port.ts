export type AiMessageRole = "system" | "user" | "assistant" | "tool";

export interface AiMessage {
  role: AiMessageRole;
  content: string;
  tool_call_id?: string;
}

export interface AiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface GenerateTextInput {
  model: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  metadata?: Record<string, string>;
}

export interface GenerateTextResult {
  text: string;
  toolCalls: AiToolCall[];
  logId?: string;
}

export interface AiPort {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}
