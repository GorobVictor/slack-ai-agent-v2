# Slack AI Agent V2

This repository is prepared for a Slack AI agent built on Cloudflare Workers and TypeScript.

## Development Guidance

- Follow the Cursor rules in `.cursor/rules/` for architecture, repository language, and Plan Mode feature documentation.
- Keep Worker entrypoints thin and place application behavior in feature-first use cases.
- Keep Cloudflare bindings and external services behind ports and adapters.
- Write repository content in English unless localized content is the explicit deliverable.

## Local Agent Workflow

Use the local `.cursor/skills/gen-commits` skill when turning uncommitted work into local commits. It groups related changes, uses the required commit subject format, and checks whether `AGENTS.md` and `README.md` need updates before finishing.
