# Private deployment preparation

Deploy only after the owner approves the target and credentials. This release ships source/build and a service-manager template, not a running installation.

On an approved Node 24 host, install with `npm ci`, run `npm run check`, provision `.env` securely, and use a dedicated unprivileged account. Keep state on a local persistent disk; one instance per database. Use restrictive directory/file permissions and encrypted host storage. Use a private authenticated connection or a reviewed gateway; the listener intentionally binds loopback and rejects unrecognized Host headers and browser Origin headers. A reverse proxy must preserve Authorization, serve TLS externally and forward an allowed loopback Host. Do not bypass these guards to make an unreviewed deployment work.

Health is liveness only. Monitor process uptime, disk usage and the count/age of pending and dead jobs using local administrative access without printing message bodies, callback URLs or secrets. Dead jobs need operator review; no automatic replay command is provided. Back up SQLite using its online backup facilities or a stopped process, not a single live database file without its WAL. Retention applies to backups separately. On restoration, expect possible repeated webhook event IDs; never delete or replay unknown send-ledger entries blindly.

The provided systemd template is an optional Linux deployment artifact; on macOS run the foreground process during an approved local trial before adding any persistent launch agent. No background service is installed automatically.
