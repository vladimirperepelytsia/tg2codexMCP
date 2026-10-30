# Security boundaries

One trusted owner and one bot per database. Telegram content remains untrusted even when transport authentication succeeds. The server never executes messages, follows embedded instructions, invokes a model API, or forwards reports automatically.

## Direct Telegram access

Polling uses a configured bot token against fixed HTTPS Bot API methods (`getMe`, `getWebhookInfo`, `getUpdates`). The destination is validated/pinned with normal TLS hostname verification; redirects are rejected. Credentials are never logged. API error descriptions/bodies are not propagated; only sanitized codes are reported. Batches have response, count and request-time limits. Shutdown aborts in-flight network work.

Polling acknowledges updates and consumes the bot's stream. It requires ownership/authorization for that stream; it cannot be shared casually with another application. Existing webhooks are refused, not replaced. Conflicts stop polling. The configured chat allowlist applies before retention, retrieval, subscriptions and sends. Disallowed-chat content is never stored, but its update is acknowledged. A database is bound to the observed bot ID to prevent accidental token changes to a different bot. A v1 adapter database has no prior bot identity; confirm its origin before binding or use a new database.

## MCP transports and sends

Stdio access is authorized by the operating-system user launching the process; there is no bearer-token exchange over private stdin/stdout. Protect the env file and local account. Explicitly enabling sends grants that local process write tools for the send allowlist. No stdout logging is permitted.

HTTP binds loopback, validates Host, rejects browser Origin headers and authenticates every request. A read token can access configured chats and, only if enabled, create subscriptions. A distinct send token additionally exposes writes when enabled. Static tokens have no OAuth discovery, expiry or per-user ACL. Do not expose this service publicly without separately reviewed authentication/network controls. Multiple HTTP clients represent the same trusted owner.

`confirmed=true` records caller intent, not an independent human approval dialog. Keep client-side write approvals. Sends are disabled by default. Durable idempotency records prevent repeating the same key; any uncertain result stays unknown and is never automatically retried, including after restart. Different keys can send duplicates, so do not generate a replacement key to bypass uncertainty.

## Optional Events and adapter

Events are off by default, require HTTP, and are advertised only in the modern protocol era. Callbacks require exact approved HTTPS hosts; all DNS answers must be public and the actual TLS connection is pinned to a validated address. No redirects or unbounded response bodies. Random challenges verify callback ownership; Standard Webhooks signs exact body/ID/timestamp. Payloads contain IDs only. Receivers must verify signatures and deduplicate event IDs. Key rotation supports a five-minute overlap, followed by active-record cleanup. Secrets are stored in the private database, not encrypted by the application.

When disabled, Events sends nothing and enqueues no new jobs; existing state may resume if re-enabled before expiry. Unsubscribe invalidates pending verification; a request already on the wire cannot be recalled. Scope/expiry is rechecked before delivery.

The optional adapter endpoint exists only in adapter mode. Its trusted sender signs raw JSON with HMAC, timestamp and durable nonce; the five-minute timestamp window and nonce table reject captured replay. This is an adapter signature, not a Telegram signature. Adapter input must be authenticated upstream. It is not required for direct polling.

## Storage and operations

Use restrictive permissions, disk encryption, quotas and protected backups. SQLite secure deletion and retention cannot erase historical backups or SSD snapshots. Contents, callback secrets, Telegram token and personal settings never belong in Git. Proxies/monitoring must not log request bodies or authorization headers.

The runtime's exclusive lock protects a database from concurrent instances. A crash may leave a stale lock: verify the recorded process is absent before an operator removes it. Do not automate unsafe stale-lock removal. Different database paths cannot prevent pollers from competing for one bot. Add stronger host/service coordination before multi-instance deployment. No live credentials, client grants, webhook mutation or public deployment was performed in development.
