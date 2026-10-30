# Roadmap and current gates

## Implemented locally

Authenticated adapter ingress, retained message tools, draft event subscriptions, verified/signed callback delivery, durable bounded retry queue, optional controlled sends, docs and fixture tests. The owner-approved development workflow targets main directly after checks.

## Next integration gates

- Choose and approve a connection path and client-compatible authentication. Static bearer auth is a private baseline; OAuth discovery/gateway remains work for clients that require it.
- Approve credentials, configured chat IDs and callback hostnames. No real credentials are created by development.
- Adapt the existing n8n payload/signing path without changing the Telegram webhook.
- Install the plugin for the actual account; verify events are discoverable and a dot can subscribe and receive them.
- Verify the management-chat destination and establish a user-confirmed report-routing contract. No private identifier belongs in reusable code.
- Authorize any real send test separately; sending stays disabled until then.

## Before broader production use

Add load testing, reviewed request rate limits, operational queue metrics, dead-letter inspection/reconciliation without message logging, database migrations, backup/restore procedures and graceful shutdown deadline. Review callback network behavior against a controlled TLS/DNS environment. Pin deployment artifacts and recheck dependency licenses/vulnerabilities. Add compliant OAuth and principal-scoped storage before multiple users. Multi-process delivery needs leases/locking before horizontal scale.

Possible later features: topic/thread filters, Unicode-aware indexed search, media metadata with separately authorized downloads, replay cursors, deleted-message handling where supported, and a portable n8n adapter package. Never promise access to history the bot does not receive.
