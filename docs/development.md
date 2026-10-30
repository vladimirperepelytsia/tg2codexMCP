# Development and validation

Use `npm ci` with the committed lockfile and Node 24.x. Run `npm run check` before committing: ESLint, TypeScript, Node test runner (via tsx), and build. No live secrets are needed. Tests use temporary SQLite files or memory, synthetic IDs and injected callback/Telegram transports. The HTTP test binds an ephemeral loopback port and closes it.

The tests cover signature binding/freshness, duplicate update/replay rejection, stale edits, pagination/search/context, subscription verification and refresh, signing-key rotation, durable delivery after reopening the database, atomic queue backpressure, retry IDs, terminal responses, retention/revocation, private-address rejection, send role enforcement and uncertain outcomes, and MCP HTTP discovery/tool/event requests. They do not constitute live Telegram, TLS/DNS infrastructure, ChatGPT installation or management-chat verification.

The dependency lockfile pins exact direct and transitive versions. Installed runtime package manifests declare: MCP server/node adapters (Apache-2.0), Zod (MIT), Standard Webhooks (MIT) and ipaddr.js (MIT). Preserve their notices when distributing dependencies and review transitive licenses when packaging. The repository retains its original Apache-2.0 license. Package publication is disabled by `private: true`.

CI runs the same `npm ci` and `npm run check` on Node 24 with read-only repository permissions. Use mocked transports in CI. Do not add live bot tokens as CI secrets just to exercise integration tests.

Protocol sources checked for this implementation:

- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), installed server 2.4.0 and node adapter 2.1.2; declarations and implementation checked locally.
- [MCP Events](https://developers.openai.com/plugins/build/mcp-events) and its linked draft specification.
- [Plugin connection](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- [Telegram Bot API](https://core.telegram.org/bots/api).

When changing a dependency or protocol, rerun wire tests and document compatibility changes. Add real failure-mode tests, not implementation mirrors. Never turn a test into a production action.
