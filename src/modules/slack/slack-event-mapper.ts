import type {
  SlackChannelType,
  SlackConnectionOpenResponse,
  SlackEvent,
  SlackEventsApiPayload,
  SlackSocketEnvelope
} from "./slack.types";

export type SlackResponseRequirement = "always" | "if_thread_active" | "never";

export type SlackReplyTarget =
  | {
      type: "message";
      channelId: string;
    }
  | {
      type: "thread";
      channelId: string;
      threadTs: string;
    };

export interface SlackAgentInput {
  sessionKey: string;
  text: string;
  userId?: string;
  channelId?: string;
  channelType?: SlackChannelType;
  messageTs?: string;
  threadTs?: string;
  replyTarget?: SlackReplyTarget;
  responseRequirement: SlackResponseRequirement;
}

export interface SlackAgentRoute {
  input: SlackAgentInput;
  replyTarget: SlackReplyTarget;
  responseRequirement: SlackResponseRequirement;
}

export function normalizeSlackConnectionOpenResponse(value: unknown): SlackConnectionOpenResponse {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_response" };
  }

  const url = readOptionalString(value, "url");
  const error = readOptionalString(value, "error");

  return {
    ok: value.ok === true,
    ...(url ? { url } : {}),
    ...(error ? { error } : {})
  };
}

export function parseSlackEnvelope(value: string): SlackSocketEnvelope | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return null;
    }

    const envelopeId = readOptionalString(parsed, "envelope_id");

    return {
      type: parsed.type,
      ...(envelopeId ? { envelope_id: envelopeId } : {}),
      accepts_response_payload: parsed.accepts_response_payload === true,
      payload: parsed.payload
    };
  } catch {
    return null;
  }
}

export function extractAgentRoute(payload: unknown, botUserId: string): SlackAgentRoute | null {
  const event = extractSlackEvent(payload);
  if (!isSupportedMessageEvent(event)) {
    return null;
  }

  const text = event.text?.trim();
  if (!text || !event.channel) {
    return null;
  }

  const sessionKey = buildSessionKey(event);
  if (!sessionKey) {
    return null;
  }

  const baseInput = {
    sessionKey,
    text,
    ...(event.user ? { userId: event.user } : {}),
    channelId: event.channel,
    ...(event.channel_type ? { channelType: event.channel_type } : {}),
    ...(event.ts ? { messageTs: event.ts } : {}),
    ...(event.thread_ts ? { threadTs: event.thread_ts } : {})
  };

  if (event.channel_type === "im") {
    const threadTs = event.thread_ts ?? event.ts;
    if (!threadTs) {
      return null;
    }

    const replyTarget: SlackReplyTarget = {
      type: "thread",
      channelId: event.channel,
      threadTs
    };
    const input: SlackAgentInput = {
      ...baseInput,
      threadTs,
      replyTarget,
      responseRequirement: "always"
    };

    return {
      input,
      replyTarget,
      responseRequirement: "always"
    };
  }

  const mentionsBot = includesBotMention(text, botUserId);
  if (mentionsBot) {
    const threadTs = event.thread_ts ?? event.ts;
    if (!threadTs) {
      return null;
    }

    const replyTarget: SlackReplyTarget = {
      type: "thread",
      channelId: event.channel,
      threadTs
    };
    const input: SlackAgentInput = {
      ...baseInput,
      replyTarget,
      responseRequirement: "always"
    };

    return { input, replyTarget, responseRequirement: "always" };
  }

  if (event.thread_ts) {
    const replyTarget: SlackReplyTarget = {
      type: "thread",
      channelId: event.channel,
      threadTs: event.thread_ts
    };
    const input: SlackAgentInput = {
      ...baseInput,
      replyTarget,
      responseRequirement: "if_thread_active"
    };

    return {
      input,
      replyTarget,
      responseRequirement: "if_thread_active"
    };
  }

  const input: SlackAgentInput = {
    ...baseInput,
    responseRequirement: "never"
  };

  return {
    input,
    replyTarget: { type: "message", channelId: event.channel },
    responseRequirement: "never"
  };
}

function extractSlackEvent(payload: unknown): SlackEvent | null {
  if (!isRecord(payload)) {
    return null;
  }

  const eventsPayload = payload as SlackEventsApiPayload;
  return eventsPayload.event ?? null;
}

function isSupportedMessageEvent(event: SlackEvent | null): event is SlackEvent {
  if (!event || event.bot_id || event.subtype) {
    return false;
  }

  return event.type === "message" || event.type === "app_mention";
}

function includesBotMention(text: string, botUserId: string): boolean {
  return new RegExp(`<@${escapeRegExp(botUserId)}(?:\\|[^>]+)?>`).test(text);
}

function buildSessionKey(event: SlackEvent): string | null {
  if (event.channel_type === "im") {
    return event.user ? `user-${event.user}` : null;
  }

  return event.channel ? `channel-${event.channel}` : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const rawValue = value[key];
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
