import { getAgentByName } from "agents";
import { ConsoleLoggerAdapter } from "../../adapters/console/console-logger.adapter";
import {
  jsonResponse,
  methodNotAllowedResponse,
  unauthorizedResponse
} from "../../tools/http-response.tool";
import type { LoggerPort } from "../../ports/logger.port";
import type { SlackReplyTarget, SlackResponseRequirement } from "../slack/slack-event-mapper";
import type { RunAgentInput, RunAgentResult } from "./agent.types";
import type { SlackConversationAgent } from "./slack-conversation.agent";

const textEncoder = new TextEncoder();

export async function handleAgentRunRequest(request: Request, env: Env): Promise<Response> {
  const logger = new ConsoleLoggerAdapter();

  if (request.method !== "POST") {
    logger.warn("agent_handler_method_not_allowed", {
      method: request.method
    });
    return methodNotAllowedResponse(["POST"]);
  }

  if (!(await isAuthorized(request, env, logger))) {
    logger.warn("agent_handler_unauthorized");
    return unauthorizedResponse();
  }

  const input = await readAgentInput(request);
  if (!input) {
    logger.warn("agent_handler_invalid_input");
    return jsonResponse({ error: "Invalid agent input" }, { status: 400 });
  }

  logger.info("agent_handler_input_received", {
    input
  });

  const agent = (await getAgentByName<Env, SlackConversationAgent>(
    env.SLACK_CONVERSATION_AGENT,
    input.sessionKey
  )) as unknown as SlackConversationAgentRpc;
  const result = await agent.run(input);

  const responseBody = {
    shouldReply: result.shouldReply,
    ...(result.text ? { text: result.text } : {}),
    ...(result.replyTarget ? { replyTarget: result.replyTarget } : {}),
    toolCalls: result.toolCalls,
    ...(result.aiGatewayLogId ? { aiGatewayLogId: result.aiGatewayLogId } : {})
  };

  logger.info("agent_handler_response_sent", {
    response: responseBody
  });

  return jsonResponse(responseBody);
}

interface SlackConversationAgentRpc {
  run(input: RunAgentInput): Promise<RunAgentResult>;
}

async function readAgentInput(request: Request): Promise<RunAgentInput | null> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const text = readOptionalString(value, "text")?.trim();
  if (!text) {
    return null;
  }

  const sessionKey = readOptionalString(value, "sessionKey");
  const responseRequirement = readResponseRequirement(value);
  if (!sessionKey || !responseRequirement) {
    return null;
  }

  const userId = readOptionalString(value, "userId");
  const channelId = readOptionalString(value, "channelId");
  const channelType = readOptionalString(value, "channelType");
  const messageTs = readOptionalString(value, "messageTs");
  const threadTs = readOptionalString(value, "threadTs");
  const replyTarget = readReplyTarget(value);

  return {
    sessionKey,
    text,
    ...(userId ? { userId } : {}),
    ...(channelId ? { channelId } : {}),
    ...(channelType ? { channelType } : {}),
    ...(messageTs ? { messageTs } : {}),
    ...(threadTs ? { threadTs } : {}),
    ...(replyTarget ? { replyTarget } : {}),
    responseRequirement
  };
}

async function isAuthorized(request: Request, env: Env, logger: LoggerPort): Promise<boolean> {
  const expectedToken = readOptionalString(env, "WORKER_CONNECTOR_TOKEN");
  if (!expectedToken) {
    logger.error("agent_auth_secret_missing");
    return false;
  }

  const headerValue = request.headers.get("Authorization");
  const token = headerValue?.startsWith("Bearer ") ? headerValue.slice("Bearer ".length) : "";

  return timingSafeEqual(token, expectedToken);
}

async function timingSafeEqual(actual: string, expected: string): Promise<boolean> {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(actual)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected))
  ]);

  const actualBytes = new Uint8Array(actualDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let diff = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < actualBytes.length; index += 1) {
    diff |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return diff === 0;
}

function readOptionalString(value: object, key: string): string | undefined {
  const record = value as Record<string, unknown>;
  const rawValue = record[key];
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : undefined;
}

function readResponseRequirement(value: object): SlackResponseRequirement | null {
  const rawValue = readOptionalString(value, "responseRequirement");
  if (rawValue === "always" || rawValue === "if_thread_active" || rawValue === "never") {
    return rawValue;
  }

  return null;
}

function readReplyTarget(value: object): SlackReplyTarget | undefined {
  const record = value as Record<string, unknown>;
  const rawValue = record.replyTarget;
  if (!isRecord(rawValue)) {
    return undefined;
  }

  const type = readOptionalString(rawValue, "type");
  const channelId = readOptionalString(rawValue, "channelId");
  if (!channelId) {
    return undefined;
  }

  if (type === "message") {
    return {
      type,
      channelId
    };
  }

  const threadTs = readOptionalString(rawValue, "threadTs");
  if (type === "thread" && threadTs) {
    return {
      type,
      channelId,
      threadTs
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
