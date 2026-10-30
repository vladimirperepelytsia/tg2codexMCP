# Development and validation

Use Node 24.x and `npm ci` with the committed lockfile. `npm run check` runs ESLint, strict TypeScript checks, Node tests through tsx, then compilation. No credentials or client accounts are required. Tests use synthetic messages, temporary SQLite state, mocked Telegram/callback networking and ephemeral loopback ports. The official MCP SDK v1 client is development-only and tests both real child-process stdio and Streamable HTTP against the SDK 2 server.

Coverage includes signatures/replay, update deduplication and ordering, chat scope, paging/search/context, optional event verification/rotation/retries, direct Telegram preflight, durable polling offsets, atomic backpressure, retry classification, migration, protocol negotiation, send uncertainty, lifecycle cancellation, startup rollback and lock cleanup. Client-specific applications and live Telegram remain documented-only integration targets; see the matrix in `clients.md`.

Runtime dependencies retain their existing licenses: MCP server/node adapters Apache-2.0; Zod, Standard Webhooks and ipaddr.js MIT. The lockfile records transitive licenses. Review notices and dependency advisories when distributing. The repository's original Apache-2.0 is unchanged and npm publication remains disabled.

CI runs `npm ci` and the same check command on Node 24 with read-only repository permissions. Never add real bot credentials just to make an integration test run. Tests must never acknowledge an owner's actual Telegram updates.

Sources checked for 0.2.0: installed SDK declarations/implementation, [MCP SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [Telegram Bot API](https://core.telegram.org/bots/api), and the per-client official pages linked in `clients.md`. Events remains a replaceable draft extension. Recheck sources when protocol or client behavior changes.
