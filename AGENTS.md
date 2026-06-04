# Agent Instructions

## Repository Rules

- Follow `.cursor/rules/cloudflare-workers-ai-architecture.mdc` for Cloudflare Workers AI architecture and TypeScript standards.
- Follow `.cursor/rules/repository-language-policy.mdc` for repository language and user communication policy.
- Follow `.cursor/rules/plan-mode-feature-docs.mdc` when Plan Mode output is approved and must be saved under `proto/features/`.
- Keep repository content in English, including code, comments, documentation, prompts, configuration, and commit messages.

## Current Project Shape

- This project is a Cloudflare Workers TypeScript template for a Slack Socket Mode AI agent with a local console connector.
- `src/cmd/worker.ts` is the thin Worker entrypoint and should only route requests, compose dependencies, and return HTTP responses.
- The Worker exposes `POST /agent/run` through `src/modules/agent/agent.handler.ts` for authenticated connector requests.
- Slack Socket Mode listening lives in `src/cmd/connector.ts`; it owns the Slack WebSocket connection, acknowledges envelopes, and forwards supported events to the Worker.
- Slack event parsing and mapping lives in `src/modules/slack/slack-event-mapper.ts`.
- AI behavior belongs in `src/modules/agent/`, with tool definitions kept allowlisted in `agent.tools.ts`.
- Use cases must depend on ports such as `src/ports/ai.port.ts`; direct Cloudflare binding access belongs in adapters such as `src/adapters/cloudflare/workers-ai.adapter.ts`.
- Runtime logs go through `src/ports/logger.port.ts` and `src/adapters/console/console-logger.adapter.ts` so connector, handler, and use case logs share a structured JSON format.
- The console connector logs Slack envelopes, Worker requests, Worker responses, and generated AI responses. Add real Slack channel replies through a future `MessengerPort` and Slack Web API adapter instead of embedding Slack Web API calls in the use case.

## Cloudflare And Wrangler

- Use `wrangler.jsonc` as the source of truth for Worker configuration.
- Run local Worker development with `npm run dev` or `npm run dev -- --env-file .env`.
- Run the Slack connector with `npm run connector:slack` in a separate terminal.
- Workers AI is configured with `remote: true` because AI bindings always use Cloudflare remote AI resources, even during local development.
- Run `npm run cf-typegen` after changing `wrangler.jsonc`; keep `worker-configuration.d.ts` in sync.
- Keep secrets out of config and source. Use `.env` for local development values and Wrangler secrets for deployed secrets.
- `SLACK_APP_TOKEN` is required by the local Slack connector and should be an app-level Slack token, usually starting with `xapp-`.
- `WORKER_CONNECTOR_TOKEN` is required by both the connector and Worker `/agent/run` endpoint.
- AI Gateway logging uses `AI_GATEWAY_ID`, `AI_GATEWAY_COLLECT_LOGS`, and `AI_GATEWAY_SOURCE` from `wrangler.jsonc` vars.

## Commands

- Install dependencies: `npm install`
- Generate Cloudflare types: `npm run cf-typegen`
- Start Wrangler dev: `npm run dev`
- Start Wrangler dev with local env file: `npm run dev -- --env-file .env`
- Start Slack connector: `npm run connector:slack`
- Validate the project: `npm run check`
- Format files: `npm run format`
- Deploy: `npm run deploy`

## Code Style And Validation

- Use TypeScript with strict types; avoid `any`.
- Keep Cloudflare bindings and external services behind ports and adapters.
- Use Prettier and ESLint as configured in the repository.
- Prettier is configured with `trailingComma: "none"`.
- Before finishing substantive changes, run `npm run check` when practical.
- Do not commit `.env`, `.dev.vars`, `.wrangler/`, `node_modules/`, or `checkpoint.md`.

## Commit Workflow

- Use `.cursor/skills/gen-commits/SKILL.md` for local commit generation.
- Do not commit `checkpoint.md`.
- Do not push to a remote unless the user explicitly asks for it.
- Keep `AGENTS.md` and `README.md` current when repository conventions, commands, setup, usage, project structure, or agent workflows change.
