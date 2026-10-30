# Direct Telegram setup

## Standalone polling

Use a bot whose update stream is dedicated to this connector. After the owner approves setup, provision its token outside Git, select numeric `ALLOWED_CHAT_IDS`, choose an absolute private database path and use `.env.example`. Launch through one MCP client's stdio configuration, or run one shared HTTP process. No adapter/workflow platform is required.

The process checks identity and webhook status before long polling. It never creates, deletes or replaces a webhook. If one exists, startup reports `telegram_webhook_already_configured` and stops; an operator must deliberately decide whether to use a different bot or separately authorize a migration. HTTP 409 similarly stops on a polling conflict. Do not run another polling consumer with the same bot.

`getUpdates` acknowledges updates through its next offset; this is an external state change, not a passive history query. First startup reads pending updates Telegram still retains. It cannot restore expired updates or fetch a complete personal account history. Visibility still depends on Telegram bot permissions/privacy. Current [Bot API docs](https://core.telegram.org/bots/api#getupdates) define the polling offset and webhook exclusion. Bot-to-bot communication is a separate Telegram setting; this connector does not enable it or assume it works.

The poller requests `message`, `edited_message`, `channel_post`, and `edited_channel_post`. It retains text/caption, chat/message/update IDs, dates and optional reply message ID. Other content types can produce a message with empty text; attachments are not downloaded. Disallowed chats are discarded, while their offset is acknowledged so they cannot block allowed chats. Changed allowlists cannot recover already discarded content.

## Modes

| Setting | Behavior |
| --- | --- |
| `INGESTION_MODE=polling` | Direct Bot API ingestion; requires bot token |
| `INGESTION_MODE=offline` | No ingestion or polling; retained reads still work |
| `INGESTION_MODE=adapter` | Optional signed HTTP ingress from an existing trusted integration; requires HTTP and ingress secret |
| `MCP_TRANSPORT=stdio` | Local child process, no network listener or MCP bearer token |
| `MCP_TRANSPORT=http` | One process on loopback; requires read bearer token |
| `ENABLE_EVENTS=false` | Default; no event capability or callback deliveries |

Polling and adapter ingress cannot run together. Offline mode does not override an explicit `ENABLE_SEND=true`; leave sending false for a fully offline session. No direct hosted Telegram webhook endpoint or automatic webhook registration is implemented. The optional adapter endpoint is not a Telegram webhook: Telegram does not produce its HMAC headers.

## Sending

Read-only is the default. After authorization, configure `ENABLE_SEND=true`, the bot token and `SEND_CHAT_IDS` (a subset of readable chats). HTTP additionally needs a distinct `MCP_SEND_TOKEN`; read credentials never expose the send tool. Stdio grants write access to its owning local process only when sending is explicitly enabled. A `confirmed` argument is caller intent, not an independent approval UI; use the client's confirmation controls. Never retry unknown results with a new key.

## Optional signed adapter ingress

For advanced compatibility only, `POST /ingress/telegram` accepts a Telegram Update when adapter mode is enabled. HMAC-SHA256 signs `timestamp + "." + nonce + "." + exactJsonBody` using `INGRESS_SECRET`. Headers: `Content-Type: application/json`, `X-Ingress-Timestamp` (Unix seconds), `X-Ingress-Nonce` (fresh 16–128 safe characters), and `X-Ingress-Signature` (`v1=` plus lowercase hex digest). Serialize once and send those bytes. Retries need fresh nonces but preserve update IDs. The adapter must authenticate its own input. This endpoint returns 404 in polling/offline modes.

## Optional dot Events

Only set `ENABLE_EVENTS=true` with HTTP transport after approving a compatible client's connection and exact `CALLBACK_HOSTS`. Events support `message.created` and `message.edited`, scoped by `chat_id`; payloads contain IDs, not text. Subscriptions require callback challenge verification and Standard Webhooks secrets. They expire within 24 hours; null cursors mean no historical replay. Nothing registers a dot automation automatically.

See [MCP Events](https://developers.openai.com/plugins/build/mcp-events) and [plugin connection](https://developers.openai.com/plugins/deploy/connect-chatgpt) for this optional integration. Availability and actual delivery in the owner's account remain unverified. Do not treat Events as a cross-client background notification guarantee.

## Live acceptance gates

Approve the bot/update-stream ownership and private credentials, then test one client discovering tools and reading a known allowed message. Verify an edit, a disallowed chat, restart/checkpoint recovery and clean shutdown. For shared HTTP, verify read/write credential separation. Real send tests need separate authorization. Event installation/callback delivery and any management-chat routing are independent future gates.
