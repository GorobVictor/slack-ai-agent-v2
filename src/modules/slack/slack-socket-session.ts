import { DurableObject } from "cloudflare:workers";
import { WorkersAiAdapter } from "../../adapters/cloudflare/workers-ai.adapter";
import { AgentUseCase } from "../agent/agent.use-case";
import type {
  SlackConnectionOpenResponse,
  SlackEvent,
  SlackEventsApiPayload,
  SlackSocketControlResult,
  SlackSocketEnvelope,
} from "./slack.types";

const SLACK_CONNECTION_OPEN_URL = "https://slack.com/api/apps.connections.open";

export class SlackSocketSession extends DurableObject<Env> {
  private socket: WebSocket | undefined;

  async openSlackSocket(): Promise<SlackSocketControlResult> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return { connected: true, message: "Slack Socket Mode connection is already open." };
    }

    if (this.socket?.readyState === WebSocket.CONNECTING) {
      return { connected: true, message: "Slack Socket Mode connection is opening." };
    }

    const token = readStringBinding(this.env, "SLACK_APP_TOKEN");
    if (!token) {
      return {
        connected: false,
        message:
          "Missing SLACK_APP_TOKEN secret. Set it with `wrangler secret put SLACK_APP_TOKEN`.",
      };
    }

    const connection = await openSlackConnection(token);
    if (!connection.ok || !connection.url) {
      return {
        connected: false,
        message: `Slack apps.connections.open failed: ${connection.error ?? "missing WebSocket URL"}`,
      };
    }

    const socket = new WebSocket(connection.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      console.log(JSON.stringify({ event: "slack_socket_open" }));
    });

    socket.addEventListener("message", (event) => {
      void this.handleSocketMessage(event).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "slack_socket_message_error",
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      });
    });

    socket.addEventListener("close", (event) => {
      console.log(
        JSON.stringify({
          event: "slack_socket_close",
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        }),
      );
      this.socket = undefined;
    });

    socket.addEventListener("error", () => {
      console.error(JSON.stringify({ event: "slack_socket_error" }));
    });

    return { connected: true, message: "Slack Socket Mode connection requested." };
  }

  closeSlackSocket(): SlackSocketControlResult {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      this.socket = undefined;
      return { connected: false, message: "Slack Socket Mode connection is not open." };
    }

    this.socket.close(1000, "Manual disconnect");
    this.socket = undefined;
    return { connected: false, message: "Slack Socket Mode connection closed." };
  }

  private async handleSocketMessage(event: MessageEvent): Promise<void> {
    if (typeof event.data !== "string") {
      console.warn(JSON.stringify({ event: "slack_socket_non_text_message" }));
      return;
    }

    const envelope = parseSlackEnvelope(event.data);
    if (!envelope) {
      console.warn(JSON.stringify({ event: "slack_socket_invalid_json" }));
      return;
    }

    if (envelope.envelope_id) {
      this.acknowledge(envelope.envelope_id);
    }

    const agentInput = extractAgentInput(envelope.payload);
    if (!agentInput) {
      return;
    }

    const ai = new WorkersAiAdapter(this.env.AI, {
      id: this.env.AI_GATEWAY_ID,
      collectLogs: this.env.AI_GATEWAY_COLLECT_LOGS,
      source: this.env.AI_GATEWAY_SOURCE,
    });
    const result = await new AgentUseCase(ai).run(agentInput);

    console.log(
      JSON.stringify({
        event: "slack_agent_response_ready",
        channelId: agentInput.channelId,
        userId: agentInput.userId,
        aiGatewayLogId: result.aiGatewayLogId,
        text: result.text,
      }),
    );
  }

  private acknowledge(envelopeId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify({ envelope_id: envelopeId }));
  }
}

async function openSlackConnection(token: string): Promise<SlackConnectionOpenResponse> {
  const response = await fetch(SLACK_CONNECTION_OPEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  return normalizeSlackConnectionOpenResponse(await response.json());
}

function normalizeSlackConnectionOpenResponse(value: unknown): SlackConnectionOpenResponse {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_response" };
  }

  const url = readOptionalString(value, "url");
  const error = readOptionalString(value, "error");

  return {
    ok: value.ok === true,
    ...(url ? { url } : {}),
    ...(error ? { error } : {}),
  };
}

function parseSlackEnvelope(value: string): SlackSocketEnvelope | null {
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
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

function extractAgentInput(
  payload: unknown,
): { text: string; userId?: string; channelId?: string } | null {
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
    ...(event.channel ? { channelId: event.channel } : {}),
  };
}

function extractSlackEvent(payload: unknown): SlackEvent | null {
  if (!isRecord(payload)) {
    return null;
  }

  const eventsPayload = payload as SlackEventsApiPayload;
  return eventsPayload.event ?? null;
}

function readStringBinding(env: object, key: string): string | undefined {
  const record = env as Record<string, unknown>;
  return readOptionalString(record, key);
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const rawValue = value[key];
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
