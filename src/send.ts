import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chatId } from './config.js';
import { Store } from './store.js';
import { AppError, type Post } from './security.js';

export const sendSchema = z.object({ chat_id: chatId, text: z.string().min(1).max(4096),
  idempotency_key: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  confirmed: z.literal(true).describe('Caller has explicit user authorization for this exact destination and text.'),
}).strict();
export class Sender {
  constructor(readonly store: Store, readonly post: Post) {}
  async send(input: z.infer<typeof sendSchema>, canSend: boolean) {
    const p = sendSchema.parse(input), c = this.store.config;
    if (!canSend || !c.sending || !c.botToken || !c.sendChats.includes(p.chat_id)) throw new AppError('send_not_allowed', 403);
    this.store.allowed(p.chat_id);
    const hash = createHash('sha256').update(JSON.stringify([p.chat_id, p.text])).digest('hex');
    const prior = this.store.db.prepare('SELECT * FROM sends WHERE id=?').get(p.idempotency_key);
    if (prior) {
      if (prior.hash !== hash) throw new AppError('idempotency_conflict', 409);
      if (prior.state !== 'sent') throw new AppError('send_outcome_unknown_do_not_retry', 409);
      return JSON.parse(String(prior.result)) as { message_id: number; chat_id: string };
    }
    if (Number(this.store.db.prepare('SELECT count(*) AS n FROM sends').get()!.n) >= 100000) throw new AppError('send_ledger_full', 503);
    // Persist before network I/O. Telegram has no idempotency token: a timeout or
    // crash remains unknown and MUST NOT cause an automatic second send.
    this.store.db.prepare('INSERT INTO sends VALUES(?,?,?,?,?)').run(p.idempotency_key, hash, 'unknown', null, Date.now());
    try {
      const res = await this.post(`https://api.telegram.org/bot${c.botToken}/sendMessage`, JSON.stringify({ chat_id: p.chat_id, text: p.text, link_preview_options: { is_disabled: true } }), {});
      const data = z.object({ ok: z.literal(true), result: z.object({ message_id: z.number().int() }) }).parse(JSON.parse(res.body));
      if (res.status !== 200) throw new Error('rejected');
      const result = { message_id: data.result.message_id, chat_id: p.chat_id };
      this.store.db.prepare("UPDATE sends SET state='sent',result=? WHERE id=?").run(JSON.stringify(result), p.idempotency_key);
      return result;
    } catch { throw new AppError('send_outcome_unknown_do_not_retry', 502); }
  }
}
