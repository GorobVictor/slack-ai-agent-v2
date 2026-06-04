import type {
  SlackConnectionOpenResponse,
  SlackEvent,
  SlackEventsApiPayload,
  SlackSocketEnvelope
} from "./slack.types";

export interface SlackAgentInput {
  text: string;
  userId?: string;
  channelId?: string;
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

export function extractAgentInput(payload: unknown): SlackAgentInput | null {
  const event = extractSlackEvent(payload);
  if (!event || event.type !== "message" || event.bot_id || event.subtype) {
    return null;
  }

  const text = event.text?.trim();
  if (!text) {
    return null;
  }

  return {
    text,
    ...(event.user ? { userId: event.user } : {}),
    ...(event.channel ? { channelId: event.channel } : {})
  };
}

function extractSlackEvent(payload: unknown): SlackEvent | null {
  if (!isRecord(payload)) {
    return null;
  }

  const eventsPayload = payload as SlackEventsApiPayload;
  return eventsPayload.event ?? null;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const rawValue = value[key];
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
