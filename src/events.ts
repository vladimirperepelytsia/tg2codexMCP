import { createHash, randomUUID } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { z } from 'zod';
import { ProtocolError } from '@modelcontextprotocol/server';
import { chatId } from './config.js';
import { AppError, callbackUrl, equal, type Post } from './security.js';
import { Store, type Subscription } from './store.js';

const args = z.object({ chat_id: chatId }).strict();
const identity = { name: z.enum(['message.created', 'message.edited']), arguments: args,
  delivery: z.object({ mode: z.literal('webhook'), url: z.string().url().max(2048) }).strict() };
export const unsubscribeSchema = z.object(identity).strict();
export const subscribeSchema = z.object({ ...identity,
  delivery: identity.delivery.extend({ secret: z.string().regex(/^whsec_[A-Za-z0-9+/]+={0,2}$/).refine(s => {
    const b = Buffer.from(s.slice(6), 'base64');
    return b.length >= 24 && b.length <= 64 && b.toString('base64') === s.slice(6);
  }) }), cursor: z.null().optional(), ttlMs: z.number().int().positive().nullable().optional(),
}).strict();
const payload = z.object({ chat_id: chatId, message_id: z.number().int(), update_id: z.number().int() }).strict();
export const eventCatalog = ['message.created', 'message.edited'].map(name => ({ name,
  description: `${name === 'message.created' ? 'New' : 'Edited'} retained Telegram message in one allowed chat. Payload contains identifiers; use telegram_context to read untrusted text. No historical replay.`,
  delivery: ['webhook'], inputSchema: z.toJSONSchema(args), payloadSchema: z.toJSONSchema(payload),
}));
function idFor(p: z.infer<typeof unsubscribeSchema>) {
  // One deployment = one principal. Its identity is stable across credential rotation.
  return 'sub_' + createHash('sha256').update(JSON.stringify(['owner', p.delivery.url, p.name, { chat_id: p.arguments.chat_id }])).digest('hex');
}
export function signedHeaders(s: Subscription, id: string, body: string, now: number) {
  let signature = new Webhook(s.secret).sign(id, new Date(now), body);
  if (s.oldSecret && (s.rotateUntil ?? 0) > now) signature += ' ' + new Webhook(s.oldSecret).sign(id, new Date(now), body);
  return { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(now / 1000)), 'webhook-signature': signature, 'X-MCP-Subscription-Id': s.id };
}
export class Events {
  private busy = false;
  private pending = new Map<string, symbol>();
  constructor(readonly store: Store, readonly post: Post) {}
  async subscribe(input: z.infer<typeof subscribeSchema>, now = Date.now()) {
    const p = subscribeSchema.parse(input);
    this.store.allowed(p.arguments.chat_id);
    callbackUrl(p.delivery.url, this.store.config.callbackHosts);
    const id = idFor(p), old = this.store.subscriptions().find(s => s.id === id);
    const attempt = Symbol();
    this.pending.set(id, attempt);
    try {
      const s: Subscription = { id, name: p.name, chat: p.arguments.chat_id, url: p.delivery.url, secret: p.delivery.secret,
        expires: now + Math.min(p.ttlMs ?? 86400000, 86400000), verifiedUntil: old?.verifiedUntil ?? 0 };
      if (old && old.secret !== s.secret) { s.oldSecret = old.secret; s.rotateUntil = now + 300000; }
      else if (old?.oldSecret && (old.rotateUntil ?? 0) > now) { s.oldSecret = old.oldSecret; s.rotateUntil = old.rotateUntil; }
      if (!old || old.secret !== s.secret || s.verifiedUntil <= now) {
        const challenge = randomUUID(), body = JSON.stringify({ type: 'verification', challenge });
        try {
          const res = await this.post(s.url, body, signedHeaders(s, `verify_${randomUUID()}`, body, now));
          const value: unknown = JSON.parse(res.body);
          if (res.status < 200 || res.status >= 300 || typeof value !== 'object' || value === null || !('challenge' in value) || typeof value.challenge !== 'string' || !equal(challenge, value.challenge)) throw new AppError('challenge_failed');
        } catch {
          throw new ProtocolError(-32015, 'Callback verification failed', { reason: 'challenge_failed' });
        }
        s.verifiedUntil = now + 300000;
      }
      if (this.pending.get(id) !== attempt) throw new AppError('subscription_superseded');
      this.store.allowed(s.chat);
      this.store.saveSubscription(s);
      return { id, refreshBefore: new Date(s.expires).toISOString(), cursor: null, truncated: false };
    } finally {
      if (this.pending.get(id) === attempt) this.pending.delete(id);
    }
  }
  unsubscribe(p: z.infer<typeof unsubscribeSchema>) {
    this.store.allowed(p.arguments.chat_id);
    const id = idFor(p);
    this.pending.delete(id);
    this.store.unsubscribe(id); return {};
  }
  async tick(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      this.store.maintain(now);
      for (const job of this.store.due(now)) {
        const s = this.store.subscriptions().find(s => s.id === job.subscription_id);
        if (!s || s.expires <= Date.now() || !this.store.config.chats.includes(s.chat)) continue;
        const event = JSON.parse(job.body) as { eventId: string };
        let status = 0;
        try { status = (await this.post(s.url, job.body, signedHeaders(s, event.eventId, job.body, Date.now()))).status; } catch { /* retry with no sensitive error logging */ }
        if (status >= 200 && status < 300) this.store.db.prepare('DELETE FROM jobs WHERE id=?').run(job.id);
        else if (status === 410) this.store.unsubscribe(s.id);
        else {
          const attempts = job.attempts + 1;
          const retry = attempts < 8 && (status === 0 || status === 408 || status === 429 || status >= 500);
          this.store.db.prepare('UPDATE jobs SET attempts=?,next_at=?,state=? WHERE id=?').run(attempts,
            Date.now() + Math.min(3600000, 1000 * 2 ** attempts) + Math.floor(Math.random() * 1000), retry ? 'pending' : 'dead', job.id);
        }
      }
    } finally { this.busy = false; }
  }
}
