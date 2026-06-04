# Agent Instructions

## Repository Rules

- Follow `.cursor/rules/cloudflare-workers-ai-architecture.mdc` for Cloudflare Workers AI architecture and TypeScript standards.
- Follow `.cursor/rules/repository-language-policy.mdc` for repository language and user communication policy.
- Follow `.cursor/rules/plan-mode-feature-docs.mdc` when Plan Mode output is approved and must be saved under `proto/features/`.
- Keep repository content in English, including code, comments, documentation, prompts, configuration, and commit messages.

## Current Project Shape

- This project is a Cloudflare Workers TypeScript Slack Socket Mode AI agent with a local Node.js console connector.
- `src/cmd/worker.ts` is the thin Worker entrypoint and should only route requests, compose dependencies, and return HTTP responses.
- The Worker exposes `POST /agent/run` through `src/modules/agent/agent.handler.ts` for authenticated connector requests.
- The Worker also exposes `GET /health`; keep new HTTP response helpers in `src/tools/http-response.tool.ts` when they are generic and reusable.
- Slack Socket Mode listening lives in `src/cmd/connector.ts`; it is a Node.js process that owns the Slack WebSocket connection, acknowledges envelopes, de-duplicates recent Slack messages, forwards supported events to the Worker, and posts AI replies back to Slack.
- Slack event parsing and reply routing lives in `src/modules/slack/slack-event-mapper.ts`.
- Slack Web API calls for bot identity, thread lookup, and posting replies live in `src/modules/slack/slack-web-api.client.ts`.
- Slack conversation memory and AI behavior live in `src/modules/agent/slack-conversation.agent.ts`, backed by Cloudflare Agents SDK Session history.
- Direct messages use `user-{userId}` Agent instances. Channels use `channel-{channelId}` Agent instances and persist supported user messages even when no Slack reply is sent.
- Direct messages reply in the user's message thread. Channel mentions reply in a thread. Follow-up channel thread messages reply only when the Agent has marked the thread active. Root channel messages without a mention are persisted but return `shouldReply: false`.
- Channel thread requests use only the current thread context by default. Explicit whole-channel requests, including channel summaries, use the current channel history across root messages and threads.
- Tool definitions stay allowlisted in `src/modules/agent/agent.tools.ts`.
- `src/modules/agent/agent.use-case.ts` is legacy/simple AI orchestration from the pre-session flow. The active `/agent/run` path resolves `SlackConversationAgent` with `getAgentByName()`; prefer evolving the Agent path unless intentionally refactoring the older use case.
- Use cases and Agents should depend on ports such as `src/ports/ai.port.ts`; direct Cloudflare binding access belongs in adapters such as `src/adapters/cloudflare/workers-ai.adapter.ts`.
- Runtime logs go through `src/ports/logger.port.ts` and `src/adapters/console/console-logger.adapter.ts` so connector, handler, and use case logs share a structured JSON format.
- Workers AI uses `@cf/google/gemma-4-26b-a4b-it` by default. Keep model calls behind `WorkersAiAdapter`, and keep tool execution allowlisted.

## Runtime Flow

- Start Wrangler for the Worker, then start the Slack connector as a separate process.
- The connector opens Slack Socket Mode with `SLACK_APP_TOKEN`, resolves the bot identity with `SLACK_BOT_TOKEN`, acknowledges each `envelope_id`, and maps supported Slack user events into `SlackAgentInput`.
- The connector sends every supported user message to `POST /agent/run` with `Authorization: Bearer <WORKER_CONNECTOR_TOKEN>`.
- `agent.handler.ts` validates method, bearer token, JSON input, and `replyTarget`, then calls `getAgentByName(env.SLACK_CONVERSATION_AGENT, input.sessionKey)`.
- `SlackConversationAgent` upserts the Slack message into Session history, decides whether to answer, scopes recent/searchable history to the current thread or channel request, calls Workers AI through `WorkersAiAdapter`, executes allowlisted tools when requested, persists assistant replies, and returns `shouldReply`, text, reply target, tool calls, and optional AI Gateway log id.
- The connector posts to Slack only when the Worker returns `shouldReply: true`.

## Cloudflare And Wrangler

- Use `wrangler.jsonc` as the source of truth for Worker configuration.
- Run local Worker development with `npm run dev` or `npm run dev -- --env-file .env`.
- Run the Slack connector with `npm run connector:slack` in a separate terminal.
- Workers AI is configured with `remote: true` because AI bindings always use Cloudflare remote AI resources, even during local development.
- Run `npm run cf-typegen` after changing `wrangler.jsonc`; keep `worker-configuration.d.ts` in sync.
- `SLACK_CONVERSATION_AGENT` is a Durable Object binding for `SlackConversationAgent`; keep its SQLite migration in `wrangler.jsonc`.
- `wrangler.jsonc` uses `nodejs_compat`; do not add Node-only runtime code to Worker modules unless it is supported by the Worker build.
- Keep secrets out of config and source. Use `.env` for local development values and Wrangler secrets for deployed secrets.
- `SLACK_APP_TOKEN` is required by the local Slack connector and should be an app-level Slack token, usually starting with `xapp-`.
- `SLACK_BOT_TOKEN` is required by the local Slack connector and should be a bot token, usually starting with `xoxb-`.
- `WORKER_AGENT_URL` is required by the local Slack connector and normally points to `http://localhost:8787/agent/run`.
- `WORKER_CONNECTOR_TOKEN` is required by both the connector and Worker `/agent/run` endpoint.
- AI Gateway logging uses `AI_GATEWAY_ID`, `AI_GATEWAY_COLLECT_LOGS`, and `AI_GATEWAY_SOURCE` from `wrangler.jsonc` vars.

## Commands

- Install dependencies: `npm install`
- Generate Cloudflare types: `npm run cf-typegen`
- Start Wrangler dev: `npm run dev`
- Start Wrangler dev with local env file: `npm run dev -- --env-file .env`
- Start Slack connector: `npm run connector:slack`
- Typecheck Worker and connector: `npm run typecheck`
- Typecheck Worker only: `npm run typecheck:worker`
- Typecheck connector only: `npm run typecheck:connector`
- Lint: `npm run lint`
- Check formatting: `npm run format:check`
- Validate the project: `npm run check`
- Format files: `npm run format`
- Deploy: `npm run deploy`

## VS Code Workflow

- `.vscode/launch.json` defines `Wrangler: Dev`, `Slack Connector: Dev`, and the `Worker + Slack Connector` compound.
- `.vscode/tasks.json` defines `wrangler: dev`, `connector: slack`, `wrangler: typegen`, `npm: check`, and `wrangler: deploy`.
- Keep these launch/tasks entries current when changing scripts, env handling, or entrypoints.

## Code Style And Validation

- Use TypeScript with strict types; avoid `any`.
- `tsconfig.json` is the Worker-focused config and excludes `src/cmd/connector.ts`.
- `tsconfig.connector.json` extends the Worker config, adds Node types, and includes the connector plus Slack modules.
- Keep Cloudflare bindings and external services behind ports and adapters.
- Keep Slack payload normalization in `src/modules/slack/slack-event-mapper.ts`; avoid duplicating Slack shape checks in the connector.
- Keep Slack Web API calls in `src/modules/slack/slack-web-api.client.ts`; do not call Slack Web API directly from the Worker Agent.
- Keep Session history records deterministic for Slack user messages where possible, using channel id and message timestamp to tolerate duplicate deliveries.
- Use Prettier and ESLint as configured in the repository.
- Prettier is configured with `trailingComma: "none"`.
- ESLint uses `typescript-eslint` typed rules and enforces `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-explicit-any`.
- Before finishing substantive changes, run `npm run check` when practical.
- Do not commit `.env`, `.dev.vars`, `.wrangler/`, `node_modules/`, or `checkpoint.md`.

## Documentation And Planning

- Feature plans live under `proto/features/` and are numbered sequentially.
- Earlier feature documents may describe superseded designs. Treat `README.md`, `AGENTS.md`, `wrangler.jsonc`, and current `src/` code as the source of truth for current behavior.
- Keep `README.md`, `.env.example`, `AGENTS.md`, and `proto/features/` in sync when setup, runtime behavior, Slack scopes, commands, or architecture change.

## Commit Workflow

- Use `.cursor/skills/gen-commits/SKILL.md` for local commit generation.
- Do not commit `checkpoint.md`.
- Do not push to a remote unless the user explicitly asks for it.
- Keep `AGENTS.md` and `README.md` current when repository conventions, commands, setup, usage, project structure, or agent workflows change.
