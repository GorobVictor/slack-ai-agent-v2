export interface SlackSocketControlResult {
  connected: boolean;
  message: string;
}

export interface SlackConnectionOpenResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface SlackSocketEnvelope {
  type: string;
  envelope_id?: string;
  accepts_response_payload?: boolean;
  payload?: unknown;
}

export interface SlackEventsApiPayload {
  event?: SlackEvent;
}

export type SlackChannelType = "channel" | "group" | "im" | "mpim";

export interface SlackEvent {
  type?: string;
  text?: string;
  user?: string;
  channel?: string;
  channel_type?: SlackChannelType;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}
