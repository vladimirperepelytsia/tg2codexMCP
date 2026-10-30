# tg2codexMCP

A self-hosted Telegram-to-MCP connector for scoped message analysis in a ChatGPT dot. It receives selected Telegram updates from an authenticated adapter (initially n8n), retains a bounded local copy, and exposes read tools and webhook events. Analysis happens in the subscribing dot; this service does not call an LLM or impersonate a dot with an API classifier.

**Status: first local implementation, not a deployed integration.** Automated tests use synthetic messages and mocked outbound endpoints. Installation in the owner's ChatGPT account, live Telegram delivery, and routing confirmed reports into a management chat remain unverified. No existing bot webhook or n8n workflow is changed by this project.

## Implemented

- TypeScript on Node.js 24, SQLite storage with transactional message updates and delivery outbox.
- Signed adapter ingress, replay detection, update deduplication, latest edited text, chat allowlists, bounded retention.
- `telegram_messages`, `telegram_search`, and `telegram_context`, with bounded pages/context and untrusted text labeling.
- Optional `telegram_send`, disabled by default, with separate credentials, destination allowlist and durable idempotency ledger.
- MCP 2 (`2026-07-28`) HTTP endpoint through the official SDK; draft `events/list`, `events/subscribe`, `events/unsubscribe` extension for `message.created` and `message.edited`.
- Verified callbacks, Standard Webhooks signatures, secret rotation, durable retries, expiration and unsubscribe.

## Local development

Requires Node.js 24.x and npm. No Telegram token is needed for tests.

```sh
npm ci
npm run check
```

`check` runs ESLint, strict TypeScript checks, fixture tests and compilation. The integration test opens only an ephemeral loopback port. Some sandboxed runners need permission to open that port. Build output goes to ignored `dist/`.

For an approved local operator setup, copy `.env.example` to ignored `.env`, provision distinct secrets, set a real read allowlist, then run:

```sh
npm run build
npm start
```

The process binds **127.0.0.1 only**. `GET /healthz` gives a minimal liveness response. `POST /mcp` requires `Authorization: Bearer <MCP_TOKEN>`; a separately configured send credential has the same owner's read scope plus sending. `POST /ingress/telegram` uses the adapter signature described in [integration setup](docs/integration.md). Placeholder secrets intentionally fail startup. Do not commit `.env` or database files.

## Scope and limitations

One process, one configured owner, one bot update stream per database. Bot updates are what the bot actually receives; retained messages are not a complete personal-account archive. Text and captions are retained; attachments, deleted-message synchronization, topic filtering, and history import are not implemented. Unsupported updates are acknowledged without retained content.

Search is a literal substring scan within one chat; SQLite `lower()` provides ASCII case folding, not full Unicode search normalization. Pagination uses decreasing Telegram message IDs. Event payloads contain IDs only; retrieve text with a read tool. Events have no historical replay cursor. A successful webhook response means receipt, not completed dot analysis.

The first release uses static bearer credentials for a trusted, private deployment. It does not implement OAuth discovery or multi-user isolation, and does not claim public plugin readiness. Callback hosts start empty and must be approved and configured. See [security](docs/security.md), [architecture](docs/architecture.md), and [roadmap](docs/roadmap.md).

## License

The existing [Apache License 2.0](LICENSE) is preserved. `private: true` in package metadata prevents accidental npm publication; it does not change the source license. No copyright owner has been invented. Runtime dependency licenses are recorded in [development guidance](docs/development.md).
