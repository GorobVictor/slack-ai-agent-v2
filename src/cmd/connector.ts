import { Buffer } from "node:buffer";
import WebSocket, { type RawData } from "ws";
import { ConsoleLoggerAdapter } from "../adapters/console/console-logger.adapter";
import {
  extractAgentInput,
  normalizeSlackConnectionOpenResponse,
  parseSlackEnvelope,
  type SlackAgentInput
} from "../modules/slack/slack-event-mapper";

const SLACK_CONNECTION_OPEN_URL = "https://slack.com/api/apps.connections.open";
const logger = new ConsoleLoggerAdapter();

interface ConnectorConfig {
  slackAppToken: string;
  workerAgentUrl: string;
  workerConnectorToken: string;
}

interface WorkerAgentResponse {
  text: string;
  toolCalls?: unknown[];
  aiGatewayLogId?: string;
}

void main().catch((error: unknown) => {
  logger.error("slack_connector_fatal_error", {
    error: error instanceof Error ? error.message : "Unknown error"
  });
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const config = readConfig();
  const connection = await openSlackConnection(config.slackAppToken);

  if (!connection.ok || !connection.url) {
    throw new Error(
      `Slack apps.connections.open failed: ${connection.error ?? "missing WebSocket URL"}`
    );
  }

  const socket = new WebSocket(connection.url);

  socket.on("open", () => {
    logger.info("slack_connector_socket_open");
  });

  socket.on("message", (data) => {
    void handleSocketMessage(data, socket, config).catch((error: unknown) => {
      logger.error("slack_connector_message_error", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    });
  });

  socket.on("close", (code, reason) => {
    logger.info("slack_connector_socket_close", {
      code,
      reason: reason.toString()
    });
  });

  socket.on("error", (error) => {
    logger.error("slack_connector_socket_error", {
      error: error.message
    });
  });
}

async function openSlackConnection(token: string) {
  const response = await fetch(SLACK_CONNECTION_OPEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: ""
  });

  return normalizeSlackConnectionOpenResponse(await response.json());
}

async function handleSocketMessage(
  data: RawData,
  socket: WebSocket,
  config: ConnectorConfig
): Promise<void> {
  const rawMessage = rawDataToString(data);
  const envelope = parseSlackEnvelope(rawMessage);
  if (!envelope) {
    logger.warn("slack_connector_invalid_envelope", {
      rawMessage
    });
    return;
  }

  logger.info("slack_connector_envelope_received", {
    rawMessage,
    envelope
  });

  if (envelope.envelope_id) {
    const acknowledgement = { envelope_id: envelope.envelope_id };
    socket.send(JSON.stringify(acknowledgement));
    logger.info("slack_connector_ack_sent", {
      acknowledgement
    });
  }

  const agentInput = extractAgentInput(envelope.payload);
  if (!agentInput) {
    logger.info("slack_connector_agent_input_skipped", {
      envelopeType: envelope.type,
      payload: envelope.payload
    });
    return;
  }

  const response = await callWorkerAgent(config, agentInput);
  logger.info("slack_connector_agent_response", {
    channelId: agentInput.channelId,
    userId: agentInput.userId,
    aiGatewayLogId: response.aiGatewayLogId,
    text: response.text,
    toolCalls: response.toolCalls ?? []
  });
}

async function callWorkerAgent(
  config: ConnectorConfig,
  input: SlackAgentInput
): Promise<WorkerAgentResponse> {
  logger.info("slack_connector_worker_request", {
    url: config.workerAgentUrl,
    input
  });

  const response = await fetch(config.workerAgentUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.workerConnectorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Worker agent request failed with ${response.status}: ${responseText}`);
  }

  const value = await response.json();
  if (!isWorkerAgentResponse(value)) {
    throw new Error("Worker agent returned an invalid response.");
  }

  logger.info("slack_connector_worker_response", {
    status: response.status,
    response: value
  });

  return value;
}

function readConfig(): ConnectorConfig {
  const slackAppToken = readEnv("SLACK_APP_TOKEN");
  const workerAgentUrl = readEnv("WORKER_AGENT_URL");
  const workerConnectorToken = readEnv("WORKER_CONNECTOR_TOKEN");

  return {
    slackAppToken,
    workerAgentUrl,
    workerConnectorToken
  };
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}

function readEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function isWorkerAgentResponse(value: unknown): value is WorkerAgentResponse {
  if (!isRecord(value) || typeof value.text !== "string") {
    return false;
  }

  if (value.toolCalls !== undefined && !Array.isArray(value.toolCalls)) {
    return false;
  }

  return value.aiGatewayLogId === undefined || typeof value.aiGatewayLogId === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
