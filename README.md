# Slack AI Agent V2

This repository contains a minimal Slack Socket Mode AI agent template built on Cloudflare Workers, Workers AI, Durable Objects, and TypeScript.

## What It Includes

- Slack Socket Mode control endpoints for opening and closing a WebSocket session.
- A `SlackSocketSession` Durable Object that owns the Slack WebSocket connection.
- A thin Worker entrypoint that delegates request handling.
- A Gemma 4 Workers AI use case with allowlisted tool calling.
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

Set the Slack app-level token as a Wrangler secret:

```bash
npx wrangler secret put SLACK_APP_TOKEN
```

The token should be a Slack app-level token with Socket Mode support, usually starting with `xapp-`.

## Development

Run the Worker through Wrangler. Durable Objects run locally in development, while Workers AI still uses Cloudflare's remote AI service:

```bash
npm run dev
```

To use local values from `.env`, pass the env file explicitly:

```bash
npm run dev -- --env-file .env
```

## VS Code Debugging

This repository includes VS Code launch and task configuration:

- Run `Wrangler: Dev` from Run and Debug to start Wrangler with `.env` and inspector port `9229`.
- Run the `wrangler: dev` task to start the same development server from the command palette.
- Run `wrangler: typegen`, `npm: check`, and `wrangler: deploy` from VS Code tasks when needed.

Open the Slack Socket Mode connection:

```bash
curl -X POST http://localhost:8787/slack/socket/connect
```

Close the active Socket Mode connection:

```bash
curl -X POST http://localhost:8787/slack/socket/disconnect
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

- Workers AI uses `@cf/google/gemma-4-26b-a4b-it` by default.
- AI Gateway logging uses `AI_GATEWAY_ID`, `AI_GATEWAY_COLLECT_LOGS`, and `AI_GATEWAY_SOURCE` from `wrangler.jsonc`.
- Slack Socket Mode events are acknowledged over WebSocket using the received `envelope_id`.
- The initial template logs generated AI responses. Posting replies back to Slack should be added through a future `MessengerPort` and Slack Web API adapter.

## Development Guidance

- Follow the Cursor rules in `.cursor/rules/` for architecture, repository language, and Plan Mode feature documentation.
- Keep Worker entrypoints thin and place application behavior in feature-first use cases.
- Keep Cloudflare bindings and external services behind ports and adapters.
- Write repository content in English unless localized content is the explicit deliverable.

## Local Agent Workflow

Use the local `.cursor/skills/gen-commits` skill when turning uncommitted work into local commits. It groups related changes, uses the required commit subject format, and checks whether `AGENTS.md` and `README.md` need updates before finishing.
