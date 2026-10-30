# Local operation and deployment preparation

No persistent service, client configuration or account credential is installed automatically. Approve the bot/update stream and settings before enabling polling. Use a dedicated bot, Node 24, private absolute DB path and `.env`; keep writes disabled for the first trial.

For one client, launch Node directly over stdio using `examples/clients`. Polling runs only while the child process runs. stdout contains JSON-RPC only, with sanitized operational errors on stderr. EOF/SIGINT/SIGTERM cancels polling and callbacks, closes the transport/database and removes the lock. An interrupted send remains unknown; it must not be retried blindly.

For multiple clients, choose `MCP_TRANSPORT=http` and run one process with `npm start` (or Node directly using an approved environment file). Clients connect with bearer auth to the loopback `/mcp` endpoint. `GET /healthz` is liveness only, not a claim of fresh Telegram data. A retrying upstream poll leaves retained reads available; fatal identity/authentication/webhook/conflict errors stop the process. Watch stderr codes and freshness operationally. No automatic `setWebhook`/`deleteWebhook` action exists.

The optional Linux systemd template runs the same program; its environment must select HTTP/polling and point DB_PATH into the writable service directory. It is a preparation artifact, not an installation. On macOS, use an approved foreground trial before any persistent launch agent. Network exposure/tunnels require separate approval and authentication review.

## Lock and state recovery

Only one process may use a database. `database_locked_or_unwritable` can mean an existing instance, leftover lock or permissions failure. The `<database>.lock` file records a PID and random ownership nonce, not credentials. Check the actual process, command and active clients before removing a stale lock. Never delete a live lock or change database paths simply to launch a second poller for the same bot. An unclean termination may require this manual step; automatic stale-lock recovery is deliberately not implemented.

The additive v1-to-v2 migration preserves messages, subscriptions, jobs and send keys. Back up state before upgrades. A database with a newer schema fails closed. The poll checkpoint commits with message/outbox work, so restart resumes after durable progress. If an unknown/malformed update blocks ingestion, investigate before any manual checkpoint change; advancing it can permanently discard updates.

Back up SQLite via online backup facilities or a stopped process, not a live database file without its WAL. Backups have their own privacy/retention requirements. Restoring an old backup can repeat webhook event IDs or roll back send evidence; reconcile uncertain sends and bot state before resuming. Monitor disk allocation and pending/dead jobs without printing bodies, secrets or callback URLs. No automatic dead-letter replay or destructive cleanup command is provided.
