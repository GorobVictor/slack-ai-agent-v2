# Slack AI Agent V2

This repository contains a minimal Slack Socket Mode AI agent template built on Cloudflare Workers, Workers AI, a local console connector, and TypeScript.

## What It Includes

- A local Slack Socket Mode connector that owns the Slack WebSocket connection and posts AI replies back to Slack.
- A thin Worker entrypoint with an authenticated `/agent/run` endpoint.
- A Cloudflare Agents SDK conversation agent with SQLite-backed Session history.
- A Gemma 4 Workers AI flow with allowlisted tool calling.
- Structured JSON console logs for Slack envelopes, Worker requests, AI steps, and tool calls.
- AI Gateway request logging configured through `wrangler.jsonc` vars.
- Minimal ESLint and Prettier setup for readable TypeScript.

## Setup

Install dependencies and generate Cloudflare binding types:

```bash
npm install
npm run cf-typegen
```

Create a local environment file from the example:

```bash
cp .env.example .env
```

Set the Worker connector token as a Wrangler secret before deploying:

```bash
npx wrangler secret put WORKER_CONNECTOR_TOKEN
```

The local connector reads `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `WORKER_AGENT_URL`, and `WORKER_CONNECTOR_TOKEN` from `.env`. `SLACK_APP_TOKEN` should be an app-level token with Socket Mode support, usually starting with `xapp-`. `SLACK_BOT_TOKEN` should be a bot token, usually starting with `xoxb-`.

The Slack app should have these bot scopes for local reply behavior:

- `app_mentions:read`
- `chat:write`
- `channels:history` and/or `groups:history` for channel message events
- `im:history` or equivalent direct message event access

## Development

The executable entrypoints live under `src/cmd`: `src/cmd/worker.ts` for the Cloudflare Worker and `src/cmd/connector.ts` for the local Slack connector.

Run the Worker through Wrangler. Workers AI uses Cloudflare's remote AI service during local development:

```bash
npm run dev
```

To use local values from `.env`, pass the env file explicitly:

```bash
npm run dev -- --env-file .env
```

Start the Slack Socket Mode connector in a second terminal:

```bash
npm run connector:slack
```

The connector opens Slack Socket Mode, acknowledges envelopes, sends supported user message events to `WORKER_AGENT_URL`, and posts generated AI responses back to Slack only when the Worker returns `shouldReply: true`. Channel mentions are answered in a thread, follow-up messages in active bot threads are answered even without a mention, direct messages are answered in the user's message thread, and ignored channel messages are still persisted in the channel session for future context.

## VS Code Debugging

This repository includes VS Code launch and task configuration:

- Run `Wrangler: Dev` from Run and Debug to start Wrangler with `.env` and inspector port `9229`.
- Run `Slack Connector: Dev` from Run and Debug to start the console connector with `.env`.
- Run the `Worker + Slack Connector` compound configuration to start both processes.
- Run the `wrangler: dev` task to start the same development server from the command palette.
- Run the `connector: slack` task to start only the Slack connector.
- Run `wrangler: typegen`, `npm: check`, and `wrangler: deploy` from VS Code tasks when needed.

Call the Worker agent endpoint directly:

```bash
curl -X POST http://localhost:8787/agent/run \
  -H "Authorization: Bearer $WORKER_CONNECTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionKey":"user-local","text":"Hello from curl","userId":"local","channelId":"DLOCAL","channelType":"im","messageTs":"1760000000.000000","threadTs":"1760000000.000000","responseRequirement":"always","replyTarget":{"type":"thread","channelId":"DLOCAL","threadTs":"1760000000.000000"}}'
```

Check service health:

```bash
curl http://localhost:8787/health
```

## Validation

Run TypeScript, ESLint, and Prettier checks:

```bash
npm run check
```

Format files:

```bash
npm run format
```

## Deployment

Deploy with Wrangler:

```bash
npm run deploy
```

## Notes

- Workers AI uses `@cf/google/gemma-4-26b-a4b-it` by default for full responses. Slack context intent classification uses `@cf/meta/llama-3.2-1b-instruct` as a cheaper lightweight model.
- AI Gateway logging uses `AI_GATEWAY_ID`, `AI_GATEWAY_COLLECT_LOGS`, and `AI_GATEWAY_SOURCE` from `wrangler.jsonc`.
- Slack Socket Mode events are acknowledged by the console connector using the received `envelope_id`.
- Slack conversation memory lives in `SlackConversationAgent` Durable Object instances. Direct messages use `user-{userId}` session keys and channels use `channel-{channelId}` session keys.
- Channel sessions store supported user messages even when no Slack reply is sent. Thread requests use the current thread context by default, while explicit whole-channel summaries use prior channel context across root messages and threads.
- Runtime logging goes through `LoggerPort` and the console logger adapter.

## Development Guidance

- Follow the Cursor rules in `.cursor/rules/` for architecture, repository language, and Plan Mode feature documentation.
- Keep Worker entrypoints thin and place application behavior in feature-first use cases.
- Keep Cloudflare bindings and external services behind ports and adapters.
- Write repository content in English unless localized content is the explicit deliverable.

## Local Agent Workflow

Use the local `.cursor/skills/gen-commits` skill when turning uncommitted work into local commits. It groups related changes, uses the required commit subject format, and checks whether `AGENTS.md` and `README.md` need updates before finishing.
