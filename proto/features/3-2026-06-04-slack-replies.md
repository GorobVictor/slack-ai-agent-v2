# Slack Reply Behavior

## Scope

Implement Slack replies for the local Socket Mode connector. The agent should respond to channel mentions in a thread, continue responding in threads where the bot is already involved, and answer direct messages as normal direct messages without using threads.

AI generation stays stateless in this iteration: each Slack event is handled independently by calling `POST /agent/run` and posting the returned text back to Slack. Slack Web API thread history is the temporary source of truth for whether the bot is already involved in a thread.

## Architecture Decision

Do not wire Cloudflare Agents SDK yet. Adding Agents now would introduce a Durable Object binding, the `agents` dependency, migrations, agent routing, and a session model before conversation memory is needed.

The future migration point is thread/session participation state. Once Cloudflare Agents session memory is added, the Worker can own thread state and conversation memory while the connector keeps sending normalized Slack event data.

## Target Flow

```mermaid
flowchart TD
  SlackEvent["Slack Socket Mode Event"] --> Connector["src/cmd/connector.ts"]
  Connector --> Mapper["src/modules/slack/slack-event-mapper.ts"]
  Mapper --> RouteDecision["Slack reply route decision"]
  RouteDecision -->|"should respond"| Worker["POST /agent/run"]
  Worker --> AgentUseCase["AgentUseCase"]
  AgentUseCase --> Connector
  Connector --> SlackPost["Slack chat.postMessage"]
  RouteDecision -->|"ignore"| Skip["No response"]
```

## Reply Rules

```mermaid
flowchart TD
  Message["Slack message event"] --> ValidUserMessage["Valid user message"]
  ValidUserMessage --> IsDM{"Direct message?"}
  IsDM -->|"yes"| DmReply["Reply as normal DM message"]
  IsDM -->|"no"| HasMention{"Mentions bot?"}
  HasMention -->|"yes"| ThreadReply["Reply in thread_ts or message ts"]
  HasMention -->|"no"| IsThread{"Thread reply?"}
  IsThread -->|"no"| Ignore["Ignore"]
  IsThread -->|"yes"| BotInThread{"Bot already in thread?"}
  BotInThread -->|"yes"| ThreadReply
  BotInThread -->|"no"| Ignore
```

## Implementation Steps

1. Extend Slack DTOs in `src/modules/slack/slack.types.ts` with `channel_type`, `ts`, and `thread_ts`.
2. Replace the current simple Slack input extraction in `src/modules/slack/slack-event-mapper.ts` with route-aware mapping:
   - direct messages produce a normal message reply target.
   - channel mentions produce a thread reply target.
   - channel thread replies without mention produce a conditional thread reply target.
   - bot messages, message subtypes, empty text, and unsupported events are ignored.
3. Add Slack Web API calls at the connector boundary:
   - `auth.test` resolves the bot user id once at startup from `SLACK_BOT_TOKEN`.
   - `conversations.replies` checks whether the bot already participated in a thread.
   - `chat.postMessage` posts the AI response to Slack.
4. Update `src/cmd/connector.ts` to:
   - read `SLACK_BOT_TOKEN`.
   - open Socket Mode with `SLACK_APP_TOKEN`.
   - acknowledge Slack envelopes immediately.
   - call the Worker only when routing says a response is required.
   - post Worker responses to Slack with the correct channel and optional `thread_ts`.
5. Extend `RunAgentInput`, `agent.handler.ts`, and AI Gateway metadata with safe Slack metadata such as message timestamp, thread timestamp, and channel type.
6. Update `.env.example`, `README.md`, and `AGENTS.md` if needed with the new Slack token, scopes, and runtime behavior.

## Slack App Requirements

The app needs Socket Mode enabled and a bot token for Web API calls. Expected scopes:

- `app_mentions:read` for channel mentions.
- `chat:write` for posting replies.
- `channels:history` for public channel thread checks where the app is installed.
- `groups:history` for private channel thread checks where the app is installed.
- `im:history` or equivalent DM event access for direct messages.

## Configuration

```txt
SLACK_APP_TOKEN=xapp-your-slack-app-level-token
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
WORKER_AGENT_URL=http://localhost:8787/agent/run
WORKER_CONNECTOR_TOKEN=replace-with-a-local-shared-secret
```

`SLACK_APP_TOKEN` is only for Socket Mode. `SLACK_BOT_TOKEN` is used for `auth.test`, `conversations.replies`, and `chat.postMessage`.

## Future Cloudflare Agents Migration

When conversation memory is introduced, move thread participation and message history into a Cloudflare Agent session. A likely session key is based on Slack workspace, channel, and thread timestamp. The connector should still normalize Slack events and send them to the Worker; the Worker Agent can then decide from persisted session state whether a thread is active and what context to include in model calls.

## Validation

Run repository validation:

```bash
npm run check
```

Manual Slack scenarios:

1. Mention the bot in a channel root message. The bot replies in a thread.
2. Reply in that thread without mentioning the bot. The bot replies in the same thread.
3. Reply in an unrelated thread where the bot has not participated. The bot ignores it.
4. Send the bot a direct message. The bot replies as a normal DM message, not in a thread.
5. Confirm messages sent by the bot are ignored and do not cause response loops.
