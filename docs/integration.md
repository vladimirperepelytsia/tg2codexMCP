# Integration setup and verification

Nothing in this guide has been applied to the owner's live systems. Keep local fixture testing separate from account permissions and deployment.

## Existing n8n ingress

Keep the existing Telegram trigger/webhook intact. After approval, add a branch that forwards the original Update JSON to `POST /ingress/telegram`. Do not switch the bot to another webhook or run competing polling. If n8n exposes a transformed item, reconstruct and test the supported Update shape; do not assume it is the original Telegram payload.

Headers:

- `Content-Type: application/json`
- `X-Ingress-Timestamp`: current Unix seconds
- `X-Ingress-Nonce`: fresh random 16–128-character alphanumeric, underscore or hyphen value
- `X-Ingress-Signature`: `v1=` followed by the lowercase hex HMAC-SHA256

The signed input is `timestamp + "." + nonce + "." + exactJsonBody`. Serialize once; use the same bytes for signing and HTTP delivery. A portable Node adapter example:

```js
import { createHmac, randomUUID } from 'node:crypto';
const body = JSON.stringify(telegramUpdate);
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomUUID();
const signature = 'v1=' + createHmac('sha256', ingressSecret)
  .update(`${timestamp}.${nonce}.${body}`).digest('hex');
// POST body with the four headers above. Keep the key in the adapter's secret store.
```

This is an adapter contract, not a preinstalled n8n workflow. n8n Code node module permissions and secret management depend on its deployment; configure a trusted signing node/sidecar if built-in crypto is unavailable. Treat 503 as backpressure and retry with a fresh nonce. Do not repeatedly retry authentication/validation failures without fixing them. Duplicate update IDs return success without emitting duplicate work.

## Telegram scope

Supported fields: `update_id` and one of `message`, `edited_message`, `channel_post`, `edited_channel_post`; retained fields are chat/message IDs, text or caption, timestamps and optional reply message ID. Unsupported update types are ignored. No full-account history import is implemented.

Bot visibility depends on permissions, privacy settings and what Telegram actually delivers. Current [Telegram Bot API documentation](https://core.telegram.org/bots/api) also describes bot-to-bot communication requiring both bots to enable it for direct bot messaging. This project neither enables that setting nor relies on it; confirm the actual chat path before deployment. A bot's ability to read a particular conversation must be verified with authorized fixtures in that environment.

## ChatGPT / dot gate

The [MCP Events documentation](https://developers.openai.com/plugins/build/mcp-events) documents webhook events for dots and MCP protocol 2026-07-28. The service implements the documented extension with the current SDK's custom-method API. Follow the official [custom MCP connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) for the account-side setup.

Remaining approval and verification sequence:

1. Select an approved private connection path (for example Secure MCP Tunnel) or a reviewed HTTPS/authentication gateway. This loopback service is not directly public. No tunnel or endpoint is provisioned by this repository.
2. Provision credentials and real allowed chat IDs outside Git. Decide how the client's connection supplies static bearer auth; if that is not supported for this account, implement a compliant OAuth gateway first. Do not disable authentication as a workaround.
3. Install/connect the custom MCP plugin and inspect tools/events. Obtain and approve the actual callback hostname; configure `CALLBACK_HOSTS`. No hostname is guessed in the example.
4. In the intended dot, request monitoring of a single authorized chat. Verify discovery, subscription, challenge response and persisted expiry. Rescan metadata after protocol changes.
5. With permission, forward a synthetic Telegram update through the actual adapter. Observe signed receipt, then verify the dot reads the expected message and performs the instructed analysis.
6. Check a filtered-out chat, duplicate update, edit, invalid signature, restart, expired subscription and unsubscribe. Confirm no unintended send or forwarding occurs.
7. Separately authorize and verify any management-chat routing only after the destination can be accessed reliably. That integration is not implemented or claimed here.

## Protocol examples

Use MCP 2-compatible tooling. HTTP requests include `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`, and method-specific name headers, plus the request `_meta` version, client capabilities and client information. The automated HTTP fixture is the executable example. The SDK rejects inconsistent headers/envelopes.

Subscribe with `name` (`message.created` or `message.edited`), `arguments: {chat_id}`, and `delivery: {mode: "webhook", url, secret}`. Signing secrets use Standard Webhooks `whsec_` base64 form (24–64 decoded bytes). The default and maximum granted TTL is 24 hours; shorter positive TTLs are honored. A null TTL still receives a finite grant. Cursors are null; replay is unsupported. Unsubscribe uses the same identity fields without the secret. Both credentials represent the same owner.
