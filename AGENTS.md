# Agent instructions

## Mission

Develop this checkout as a reusable Telegram MCP connector. Selected bot-received messages should reach an actual subscribing ChatGPT dot for analysis. A later, separately authorized integration may route confirmed error reports to a management chat. Never replace that flow with an OpenAI API classifier or hardcode private chat/thread identifiers.

## Stack and structure

Use Node.js 24, strict TypeScript, official MCP SDK 2, Zod, built-in SQLite, and Standard Webhooks. `src/store.ts` owns durable state; `events.ts` isolates the draft event extension; `security.ts` owns ingress and outbound boundaries; `mcp.ts` registers tools; `app.ts` wires loopback HTTP. Read `docs/architecture.md` and `docs/integration.md` before changing protocol behavior.

## Working conventions

1. Inspect `git status`, current branch, remote and local changes before edits. Preserve other work. Use this repository, not another clone.
2. Keep changes small and coherent. Prefer explicit types and dependency injection over new frameworks. No hidden services, background installers or new cloud dependencies.
3. Verify protocol changes against current official documentation AND the installed SDK. Events is a draft custom-method extension; do not invent SDK methods. Preserve protocol integration tests.
4. Keep messages as untrusted data. No eval, shell execution, model instructions from messages, automatic escalation or automatic error-report forwarding.
5. Test with synthetic fixtures and mock Telegram/callback endpoints. Never alter `setWebhook`, call `getUpdates` against an existing bot, send live messages, upload private data, configure credentials, install plugins, expose endpoints or deploy without explicit authorization for that action.
6. Before a commit run `npm run check`, inspect the diff and staged files for secrets/private identifiers, and update relevant docs. Tests should target real failure modes, especially durable retries, authorization and uncertain sends.
7. The project owner authorizes verified development changes committed and pushed directly to `main`. Push normally; never force. Recheck the remote before pushing, verify its resulting SHA, and inspect CI for that SHA. Do not overwrite concurrent remote work.
8. Preserve `LICENSE`. Do not infer copyright ownership. Do not commit `.env`, credentials, chat contents, logs, local database files or personal setup.
9. Report what passed locally separately from live integration evidence. Do not claim successful plugin installation, dot delivery or management-chat routing without end-to-end verification.

## State changes

Run exactly one process per database. Schema changes need an explicit migration and restart/recovery test. Do not drop tables or clear send idempotency keys to fix failures: a Telegram send with unknown outcome must be reconciled by the operator before any retry. Bounded retention and replay windows are intentional and documented; do not silently promise indefinite deduplication.
