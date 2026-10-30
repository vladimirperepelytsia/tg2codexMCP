# MCP client setup

Build first with Node 24: `npm ci && npm run check`. Examples point to compiled `dist/src/main.js`, never a published npm package. Replace `/ABSOLUTE/PATH/TO/node` with the actual Node 24 executable and all project/state paths. Keep the bot token in the private `.env`, not client JSON checked into Git. Its configuration should use stdio/polling with sending and Events disabled for the first live trial.

**Pick one stdio client at a time for a bot/database.** Each client launches its own subprocess. To use multiple clients simultaneously, launch one HTTP service using `examples/http.env.example` and connect them to its URL instead. This is shared access for one trusted owner, not multi-user isolation. A cloud-hosted client cannot reach your machine's loopback address automatically.

## Codex CLI / IDE

Merge [codex.toml](../examples/clients/codex.toml) into `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`). It launches Node with an absolute env file and script. Inspect the connection with `codex mcp list` and `/mcp`; verify a read-tool call before enabling writes. For shared HTTP, use the alternative `url` and `bearer_token_env_var` block, with the named variable containing the service's read token in the client environment.

These command/args and bearer-token settings are documented in the [official Codex MCP guide](https://developers.openai.com/codex/mcp). Local configuration does not by itself install a hosted ChatGPT plugin or activate a dot subscription. No real Codex account settings were modified for this release.

## Cursor

Merge [cursor.json](../examples/clients/cursor.json) into `.cursor/mcp.json` for a project or `~/.cursor/mcp.json` for user scope. Inspect/enable the server in Cursor's MCP settings and test a read call. Keep tool approval enabled.

For a shared HTTP service, replace the stdio entry with:

```json
{"mcpServers":{"telegram":{"url":"http://127.0.0.1:8787/mcp","headers":{"Authorization":"Bearer ${env:TELEGRAM_MCP_READ_TOKEN}"}}}}
```

Cursor documents stdio, Streamable HTTP, configuration locations and this environment interpolation in its [MCP documentation](https://cursor.com/docs/mcp). The example targets local Cursor; hosted agents need a separately approved reachable endpoint. Cursor itself was not installed or exercised during this verification.

## Gemini CLI

Merge [gemini.json](../examples/clients/gemini.json) into `~/.gemini/settings.json` or the intended project's `.gemini/settings.json`. Leave `trust: false` so the client retains confirmation behavior. Use `/mcp` to inspect tool discovery and call a read tool with an allowed chat ID.

For shared HTTP use `httpUrl`, **not** `url` (which selects legacy SSE):

```json
{"mcpServers":{"telegram":{"httpUrl":"http://127.0.0.1:8787/mcp","headers":{"Authorization":"Bearer ${TELEGRAM_MCP_READ_TOKEN}"},"trust":false}}}
```

The [Gemini CLI MCP guide](https://geminicli.com/docs/tools/mcp-server/) documents these transport/configuration fields and environment expansion. This support statement is specifically for **Gemini CLI**. It does not establish custom local MCP support in the consumer Gemini web/mobile app or every Gemini API surface. Those surfaces require separate documentation and integration work; no universal Gemini compatibility is claimed.

## Claude Code

Merge [claude-code.json](../examples/clients/claude-code.json) into the project's `.mcp.json`, or register a local server after setup approval:

```sh
claude mcp add --transport stdio telegram -- /ABSOLUTE/PATH/TO/node \
  --env-file=/ABSOLUTE/PATH/TO/tg2codexMCP/.env \
  /ABSOLUTE/PATH/TO/tg2codexMCP/dist/src/main.js
```

Use `/mcp` to inspect it, approve project settings as appropriate, then test a read call. For shared HTTP, use a `type: "http"`, `url` and `headers` entry; Claude Code supports `${TELEGRAM_MCP_READ_TOKEN}` expansion in `.mcp.json`. Avoid putting secrets directly in shell commands/history.

The [Claude Code MCP guide](https://code.claude.com/docs/en/mcp) documents the transports and configuration. Its short shutdown window is why this server aborts long polling immediately on SIGINT/SIGTERM or stdin EOF. Real Claude Code connection and prompt behavior were not tested.

## Claude Desktop (local chat)

For manual local MCP setup, merge [claude-desktop.json](../examples/clients/claude-desktop.json) into the configuration opened by Settings → Developer → Edit Config, when available. The [official MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) documents this workflow, including `claude_desktop_config.json` on macOS and Windows. Use absolute paths, fully restart Desktop, inspect tools, then test a read call.

Anthropic's current [local MCP support page](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) emphasizes desktop extensions and organization policy controls. This repository does not yet ship an `.mcpb` bundle. If manual developer configuration is unavailable in the installed version/policy, use Claude Code or prepare a separately reviewed desktop extension; do not claim the bundle is already installed. Local stdio setup is not equivalent to configuring Claude web/mobile or an API MCP connector. Those remote surfaces require separately approved hosting/authentication and are not verified here.

## Verification matrix

| Surface / behavior | Evidence in this repository | Remaining verification |
| --- | --- | --- |
| Legacy MCP stdio | Official SDK v1.32.2 client initializes, lists and calls tools in a real child process | Individual application UX/approvals |
| Legacy Streamable HTTP | Official SDK v1 client authenticates, initializes, lists and calls tools | Client-specific HTTP configuration |
| MCP 2 stdio | Wire discovery succeeds with tools and Events absent by default | Vendor runtime behavior |
| MCP 2 HTTP + optional Events | Wire discovery, tools and subscription challenge tested | Actual event-capable account/plugin |
| Codex CLI/IDE | Official docs checked; configuration example provided | Actual Codex connection/tool call not run |
| Cursor | Official docs checked; configuration example provided | Application connection not run |
| Gemini CLI | Official docs checked; configuration example provided | CLI connection not run |
| Claude Code | Official docs checked; configuration example provided | CLI connection not run |
| Claude Desktop | Official/manual setup docs checked; example provided | Installed version/policy and UI not tested; no bundle |
| Telegram ingestion | Mock Bot API, offset/restart/filter/backpressure tests | Approved real bot trial |
| Lifecycle | EOF, SIGINT, SIGTERM, in-flight poll cancellation, lock/restart and failed HTTP bind tested | Platform-specific service-manager testing |

Documentation was checked on 2026-10-30. Generic MCP protocol tests establish the implemented transport behavior, not account permissions, client availability, universal model compatibility or end-to-end live Telegram operation.
