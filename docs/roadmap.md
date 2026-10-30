# Roadmap and live gates

## Implemented

Standalone direct Telegram Bot API polling; optional offline/adapter ingestion modes; stdio and authenticated Streamable HTTP tools for legacy/modern MCP; durable message/checkpoint migration, allowlists and retention; optional controlled sends; opt-in HTTP Events; startup/shutdown cancellation and database locking; fixture/interoperability tests and client-specific examples. No workflow platform dependency remains.

## Next live acceptance steps

1. Approve a dedicated bot/update stream and provision its token plus allowed chat IDs privately. Confirm any existing webhook/consumer before enabling polling.
2. Configure one intended MCP client with its documented example; verify discovery, a known message, edits, filtering and restart. Application configurations were not installed during development.
3. If multiple clients are needed simultaneously, run one HTTP process and verify bearer scopes from each client. Keep the single-owner boundary explicit.
4. Separately authorize a real send test. Leave sends disabled until then.
5. Optional only: approve callback hosts and connect an Events-capable client; verify its actual subscription/delivery lifecycle. Management-chat routing requires a separate confirmed destination and instruction contract.

## Future work

Operational freshness/queue diagnostics without content logging, Unicode-aware indexed search, topic filters, media metadata/download policy, reviewed desktop extension packaging, optional direct hosted Telegram webhook mode, rate limits and disk quotas, load/backup/restore exercises, and client UI acceptance tests. Add OAuth/principal-scoped storage before public multi-user hosting. Distributed delivery requires leases/coordination; do not run multiple instances on this database.

Generic MCP tool access does not schedule background conversation runs in every client. Cross-client push/task semantics require client-specific integration and are not promised by optional dot Events. Personal-account/full-history access is outside the Bot API connector's scope.
