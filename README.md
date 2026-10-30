# tg2codexMCP

A standalone Telegram MCP server for **Codex, Cursor, Gemini CLI, Claude Code and Claude Desktop**. It reads bot-received updates directly from the Telegram Bot API, retains a bounded local copy, and exposes tools for message retrieval, context, search and optional controlled sends. **No n8n, workflow platform, LLM API or dot is required.** The connected client performs analysis using its own model.

**Status: locally tested implementation, not a live integration certification.** The official MCP SDK client passes stdio and Streamable HTTP integration tests. Client-specific setup is based on official documentation; the five applications have not been configured or exercised against a live bot. See the [verification matrix](docs/clients.md#verification-matrix).

## Quick start

Requires Node.js 24.x and npm. Build and test without credentials:

```sh
npm ci
npm run check
```

After approving use of a dedicated bot, copy `.env.example` to ignored `.env`, supply the bot token and allowed chat IDs, and set an **absolute** private `DB_PATH`. Keep sending disabled initially. Configure one client using an [example](examples/clients/) and the [client instructions](docs/clients.md). Each example launches Node directly; do not use `npm start` as the client's stdio command because npm can write non-protocol output to stdout.

The default is `MCP_TRANSPORT=stdio` and `INGESTION_MODE=polling`. The client starts/stops the process. `INGESTION_MODE=offline` reads retained data with no polling; an [offline template](examples/offline.env.example) needs no secrets. Polling starts on process launch and acknowledges Telegram updates, so do not enable it casually for a bot used elsewhere.

For multiple clients at once, run **one** HTTP connector with [the HTTP template](examples/http.env.example), then connect clients to `http://127.0.0.1:8787/mcp` with the configured bearer token. `npm start` is suitable for that foreground HTTP process. Never run several polling processes for the same bot, even with different databases. A database lock prevents accidental concurrent use of the same database.

## Tools

| Tool | Behavior |
| --- | --- |
| `telegram_messages` | Newest retained messages in one allowed chat; keyset pagination |
| `telegram_search` | Literal substring search within one allowed chat |
| `telegram_context` | One retained message and bounded neighboring messages |
| `telegram_send` | Optional, explicitly enabled, allowlisted send with durable idempotency |

Read tools work independently of event subscriptions. Text is marked as untrusted data. Sends require `ENABLE_SEND=true`, a bot token, `SEND_CHAT_IDS`, `confirmed=true` and an idempotency key. HTTP also requires a separate send bearer credential. For stdio, access is granted by explicitly enabling writes for the locally launched process. Keep the host client's approval prompts enabled.

## Ingestion and transports

- Direct long polling checks `getMe` and `getWebhookInfo`, then calls `getUpdates`. It never sets/deletes a webhook. An active webhook, authentication failure or polling conflict stops the service with a sanitized error.
- SQLite persists messages, edits, the polling checkpoint, optional event subscriptions/outbox and send results. Message storage and checkpoint advancement commit together. Disallowed-chat contents are discarded before retention.
- Standard MCP tools support legacy 2025 initialization and MCP 2 (`2026-07-28`) over stdio and Streamable HTTP through the official SDK. Legacy SSE-only endpoints are not implemented.
- Dot-specific webhook Events are an **optional, disabled-by-default HTTP extension**. They are not advertised to legacy clients. Ordinary clients discover tools without Events, callbacks or signing secrets.

## Scope and limits

One configured owner and one bot per database; no personal-account login or complete historical archive. This receives only updates Telegram delivers to the bot. Text/captions and edits are retained; media download, deleted-message synchronization and topic filtering are not implemented. Retention defaults to seven days. Search has SQLite's ASCII case folding, not full Unicode normalization.

A standalone client gets tools, not an automatic background task in its conversation. Generic cross-client wake-ups are not implemented. Optional Events require a compatible client and separate live verification. HTTP is loopback-only with static bearer auth; public OAuth/multi-user deployment remains future work.

Read [architecture](docs/architecture.md), [direct Telegram setup](docs/integration.md), [security](docs/security.md), [operations](docs/operations.md) and [roadmap](docs/roadmap.md). Existing signed adapter ingress remains opt-in for advanced integrations; it is not used by the standalone setup.

## License

[Apache License 2.0](LICENSE), preserved from the original repository. Package publication is disabled by `private: true`; this does not change the source license.
