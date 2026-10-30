# Security boundaries

This service is initially for one trusted owner on a private machine. It is not a public multi-tenant service. A stolen read credential exposes all configured chats and permits subscriptions to configured callback hosts. A stolen send credential additionally permits sends to the send allowlist when sending is enabled. `confirmed=true` records caller intent; it is not an independent human approval mechanism. Keep write credentials out of read-only plugin connections.

## Ingress

The connector accepts forwarded Telegram Update objects, not direct Telegram webhooks. The trusted adapter must verify its own source and keep the connector ingress key private. HMAC-SHA256 covers timestamp, nonce and exact raw body, with a five-minute clock window and durable nonce rejection. Each retry uses a fresh nonce/signature, preserving `update_id`. TLS is required if forwarding crosses machines. Header secrets and body text are never logged by application code.

The adapter's key can forge updates: it is an explicit trust boundary. This is not a Telegram cryptographic signature. Telegram's own webhook secret header must be checked upstream if that mode is used. This project never registers or replaces a bot webhook.

## MCP and callbacks

The listener binds loopback, validates Host and rejects browser Origin headers. Static bearer tokens authenticate one owner; the send token is separate. The process does not trust user-supplied owner IDs. Token changes require restart. There is no OAuth server, token expiry or per-user ACL yet. Public exposure requires a reviewed authentication gateway and transport setup, not just an open port.

Subscriptions use exact approved callback hostnames, HTTPS on port 443, and no URL credentials or fragments. Every verification and delivery resolves the hostname, rejects all non-public answers, pins a validated address for the connection and retains the original TLS hostname. Redirects are not followed. Requests and responses have size and time bounds. Callback challenges contain fresh random data; only a successful exact echo activates delivery. Standard Webhooks signing binds body, timestamp and ID. Receivers must verify signatures and deduplicate IDs; local tests exercise signature rejection via the library.

Signing secrets are stored in SQLite with restricted file permissions, not encrypted at rest by this application. Use host disk encryption and protected backups. Secret refresh supports a five-minute overlap; old keys are removed from active records by maintenance after that window. Subscriptions are rechecked against current allowlists and expiration during delivery. An in-flight request may already have been sent when unsubscribe/revocation occurs.

## Data and operations

Messages, captions and callback secrets are sensitive local state. Event payloads carry identifiers only. Retention removes service records but cannot erase remote receiver copies or historical backups. Attachments are not fetched. Disallow logging request headers/bodies in proxies, n8n and monitoring. The service reports only small operational event codes.

Payload text is untrusted even when transport authentication succeeds. The connector does not execute text, classify bugs, follow embedded instructions, forward to a management chat, or create automation tasks. Those actions belong to the actual dot under the user's explicit instructions and confirmation policy.

Resource limits constrain payloads, queries, connections, subscriptions and queue size. Add upstream rate limits and disk quotas before network exposure. Audit all dependencies and remote endpoints before production use. Exactly one worker/process is supported; multiple instances could duplicate outbox deliveries and are outside this release's operating contract.
