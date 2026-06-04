import type {
  AiPort,
  AiToolCall,
  GenerateTextInput,
  GenerateTextResult,
} from "../../ports/ai.port";

interface WorkersAiGatewayConfig {
  id: string;
  collectLogs: boolean;
  source: string;
}

export class WorkersAiAdapter implements AiPort {
  constructor(
    private readonly ai: Ai,
    private readonly gateway: WorkersAiGatewayConfig,
  ) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const response = await this.ai.run(
      input.model as never,
      {
        messages: input.messages,
        tools: input.tools,
        stream: false,
      } as never,
      {
        gateway: {
          id: this.gateway.id,
          collectLog: this.gateway.collectLogs,
          metadata: {
            source: this.gateway.source,
            ...input.metadata,
          },
        },
      } as never,
    );

    const normalized = normalizeAiResponse(response);
    const logId = readOptionalString(this.ai, "aiGatewayLogId");

    return {
      ...normalized,
      ...(logId ? { logId } : {}),
    };
  }
}

function normalizeAiResponse(response: unknown): Omit<GenerateTextResult, "logId"> {
  if (!isRecord(response)) {
    return { text: "", toolCalls: [] };
  }

  const directResponse = readOptionalString(response, "response");
  if (directResponse) {
    return {
      text: directResponse,
      toolCalls: normalizeToolCalls(response.tool_calls),
    };
  }

  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : undefined;

  if (!message) {
    return { text: "", toolCalls: normalizeToolCalls(response.tool_calls) };
  }

  return {
    text: readOptionalString(message, "content") ?? "",
    toolCalls: normalizeToolCalls(message.tool_calls),
  };
}

function normalizeToolCalls(value: unknown): AiToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const normalized = normalizeToolCall(item);
    return normalized ? [normalized] : [];
  });
}

function normalizeToolCall(value: unknown): AiToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readOptionalString(value, "id") ?? crypto.randomUUID();
  const fn = isRecord(value.function) ? value.function : undefined;
  const name = fn ? readOptionalString(fn, "name") : readOptionalString(value, "name");

  if (!name) {
    return null;
  }

  const rawArguments = fn ? fn.arguments : value.arguments;

  return {
    id,
    name,
    arguments: parseToolArguments(rawArguments),
  };
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function readOptionalString(value: object, key: string): string | undefined {
  const record = value as Record<string, unknown>;
  const rawValue = record[key];
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
