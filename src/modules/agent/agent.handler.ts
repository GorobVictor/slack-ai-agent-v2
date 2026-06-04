import { WorkersAiAdapter } from "../../adapters/cloudflare/workers-ai.adapter";
import {
  jsonResponse,
  methodNotAllowedResponse,
  unauthorizedResponse
} from "../../tools/http-response.tool";
import { AgentUseCase } from "./agent.use-case";
import type { RunAgentInput } from "./agent.types";

const textEncoder = new TextEncoder();

export async function handleAgentRunRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowedResponse(["POST"]);
  }

  if (!(await isAuthorized(request, env))) {
    return unauthorizedResponse();
  }

  const input = await readAgentInput(request);
  if (!input) {
    return jsonResponse({ error: "Invalid agent input" }, { status: 400 });
  }

  const ai = new WorkersAiAdapter(env.AI, {
    id: env.AI_GATEWAY_ID,
    collectLogs: readBooleanBinding(env, "AI_GATEWAY_COLLECT_LOGS"),
    source: env.AI_GATEWAY_SOURCE
  });
  const result = await new AgentUseCase(ai).run(input);

  return jsonResponse({
    text: result.text,
    toolCalls: result.toolCalls,
    ...(result.aiGatewayLogId ? { aiGatewayLogId: result.aiGatewayLogId } : {})
  });
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

  const userId = readOptionalString(value, "userId");
  const channelId = readOptionalString(value, "channelId");

  return {
    text,
    ...(userId ? { userId } : {}),
    ...(channelId ? { channelId } : {})
  };
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const expectedToken = readOptionalString(env, "WORKER_CONNECTOR_TOKEN");
  if (!expectedToken) {
    console.error(JSON.stringify({ event: "agent_auth_secret_missing" }));
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

function readBooleanBinding(env: object, key: string): boolean {
  const record = env as Record<string, unknown>;
  const rawValue = record[key];

  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  return rawValue === "true";
}

function readOptionalString(value: object, key: string): string | undefined {
  const record = value as Record<string, unknown>;
  const rawValue = record[key];
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
