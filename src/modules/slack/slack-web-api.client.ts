import type { SlackReplyTarget } from "./slack-event-mapper";

const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";
const SLACK_CONVERSATIONS_REPLIES_URL = "https://slack.com/api/conversations.replies";
const SLACK_CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

interface SlackApiBaseResponse {
  ok: boolean;
  error?: string;
}

interface SlackAuthTestResponse extends SlackApiBaseResponse {
  user_id?: string;
}

interface SlackConversationMessage {
  user?: string;
}

interface SlackConversationRepliesResponse extends SlackApiBaseResponse {
  messages?: SlackConversationMessage[];
  response_metadata?: {
    next_cursor?: string;
  };
}

interface SlackPostMessageResponse extends SlackApiBaseResponse {
  channel?: string;
  ts?: string;
}

export class SlackWebApiClient {
  constructor(private readonly botToken: string) {}

  async getBotUserId(): Promise<string> {
    const response = await this.postForm(SLACK_AUTH_TEST_URL, new URLSearchParams());
    const value = normalizeSlackAuthTestResponse(await response.json());

    if (!value.ok || !value.user_id) {
      throw new Error(`Slack auth.test failed: ${value.error ?? "missing user_id"}`);
    }

    return value.user_id;
  }

  async isBotInThread(channelId: string, threadTs: string, botUserId: string): Promise<boolean> {
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        channel: channelId,
        ts: threadTs,
        limit: "200"
      });

      if (cursor) {
        params.set("cursor", cursor);
      }

      const response = await this.get(`${SLACK_CONVERSATIONS_REPLIES_URL}?${params.toString()}`);
      const value = normalizeSlackConversationRepliesResponse(await response.json());

      if (!value.ok) {
        throw new Error(`Slack conversations.replies failed: ${value.error ?? "unknown_error"}`);
      }

      if (value.messages?.some((message) => message.user === botUserId)) {
        return true;
      }

      cursor = value.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return false;
  }

  async postMessage(
    text: string,
    replyTarget: SlackReplyTarget
  ): Promise<SlackPostMessageResponse> {
    const body = {
      channel: replyTarget.channelId,
      text,
      ...(replyTarget.type === "thread" ? { thread_ts: replyTarget.threadTs } : {})
    };

    const response = await fetch(SLACK_CHAT_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });
    const value = normalizeSlackPostMessageResponse(await response.json());

    if (!response.ok || !value.ok) {
      throw new Error(`Slack chat.postMessage failed: ${value.error ?? response.statusText}`);
    }

    return value;
  }

  private async get(url: string): Promise<Response> {
    return fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.botToken}`
      }
    });
  }

  private async postForm(url: string, body: URLSearchParams): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
  }
}

function normalizeSlackAuthTestResponse(value: unknown): SlackAuthTestResponse {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_response" };
  }

  return {
    ok: value.ok === true,
    ...readOptionalStringProperty(value, "user_id"),
    ...readOptionalStringProperty(value, "error")
  };
}

function normalizeSlackConversationRepliesResponse(
  value: unknown
): SlackConversationRepliesResponse {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_response" };
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.filter(isRecord).map((message) => ({
        ...readOptionalStringProperty(message, "user")
      }))
    : undefined;

  const responseMetadata = isRecord(value.response_metadata)
    ? {
        ...readOptionalStringProperty(value.response_metadata, "next_cursor")
      }
    : undefined;

  return {
    ok: value.ok === true,
    ...(messages ? { messages } : {}),
    ...(responseMetadata ? { response_metadata: responseMetadata } : {}),
    ...readOptionalStringProperty(value, "error")
  };
}

function normalizeSlackPostMessageResponse(value: unknown): SlackPostMessageResponse {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_response" };
  }

  return {
    ok: value.ok === true,
    ...readOptionalStringProperty(value, "channel"),
    ...readOptionalStringProperty(value, "ts"),
    ...readOptionalStringProperty(value, "error")
  };
}

function readOptionalStringProperty<TKey extends string>(
  value: Record<string, unknown>,
  key: TKey
): Partial<Record<TKey, string>> {
  const rawValue = value[key];
  return typeof rawValue === "string" && rawValue.length > 0
    ? ({ [key]: rawValue } as Partial<Record<TKey, string>>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
