import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './security.js';

const int = z.number().int().safe();
const message = z.object({
  message_id: int.positive(), date: int.nonnegative(), edit_date: int.nonnegative().optional(),
  chat: z.object({ id: int }), text: z.string().max(16384).optional(), caption: z.string().max(16384).optional(),
  reply_to_message: z.object({ message_id: int.positive() }).optional(),
});
export const updateSchema = z.object({
  update_id: int.nonnegative(), message: message.optional(), edited_message: message.optional(),
  channel_post: message.optional(), edited_channel_post: message.optional(),
}).refine(v => [v.message, v.edited_message, v.channel_post, v.edited_channel_post].filter(Boolean).length <= 1);
export type Subscription = {
  id: string; name: string; chat: string; url: string; secret: string; expires: number;
  oldSecret?: string; rotateUntil?: number; verifiedUntil: number;
};
export type MessageRow = { chat_id: string; message_id: number; text: string; date: number; version: number; update_id: number; reply_to: number | null; retained_at: number };
export type Job = { id: string; subscription_id: string; body: string; attempts: number; next_at: number; created: number; state: string };

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly config: Config) {
    if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(config.dbPath);
    if (config.dbPath !== ':memory:') chmodSync(config.dbPath, 0o600);
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 1) { this.db.close(); throw new AppError('unsupported_database_version', 500); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS messages(chat_id TEXT, message_id INTEGER, text TEXT NOT NULL,
        date INTEGER, version INTEGER, update_id INTEGER, reply_to INTEGER, retained_at INTEGER,
        PRIMARY KEY(chat_id,message_id));
      CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY, created INTEGER);
      CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY, created INTEGER);
      CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, subscription_id TEXT REFERENCES subscriptions(id) ON DELETE CASCADE,
        body TEXT NOT NULL, attempts INTEGER DEFAULT 0, next_at INTEGER, created INTEGER, state TEXT DEFAULT 'pending');
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,next_at);
      CREATE TABLE IF NOT EXISTS sends(id TEXT PRIMARY KEY, hash TEXT, state TEXT, result TEXT, created INTEGER);
      PRAGMA user_version=1;`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  subscriptions(): Subscription[] {
    return this.db.prepare('SELECT value FROM subscriptions').all().map(r => JSON.parse(String(r.value)) as Subscription);
  }
  saveSubscription(s: Subscription) {
    if (!this.subscriptions().some(v => v.id === s.id) && this.subscriptions().length >= this.config.maxSubscriptions) throw new AppError('subscription_limit', 429);
    this.db.prepare('INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(s.id, JSON.stringify(s));
  }
  unsubscribe(id: string) { this.db.prepare('DELETE FROM subscriptions WHERE id=?').run(id); }
  allowed(chat: string) { if (!this.config.chats.includes(chat)) throw new AppError('chat_not_allowed', 403); }
  ingest(input: unknown, nonce: string, now = Date.now()) {
    const update = updateSchema.parse(input);
    const m = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
    if (m) this.allowed(String(m.chat.id));
    return this.transaction(() => {
      const replay = this.db.prepare('INSERT OR IGNORE INTO nonces VALUES(?,?)').run(nonce, now);
      if (!replay.changes) throw new AppError('replayed_request', 409);
      if (!this.db.prepare('INSERT OR IGNORE INTO updates VALUES(?,?)').run(update.update_id, now).changes) return { status: 'duplicate' };
      if (!m) return { status: 'ignored' };
      const chat = String(m.chat.id), version = m.edit_date ?? m.date;
      if (version * 1000 < now - this.config.retentionDays * 86400000 || version * 1000 > now + 300000) return { status: 'outside_retention' };
      const old = this.db.prepare('SELECT * FROM messages WHERE chat_id=? AND message_id=?').get(chat, m.message_id) as MessageRow | undefined;
      if (old && (old.version > version || (old.version === version && old.update_id >= update.update_id))) return { status: 'stale' };
      const text = m.text ?? m.caption ?? '';
      // Equivalent retransmissions under a different update ID do not emit again.
      if (old && old.version === version && old.text === text) {
        // Advance the ordering watermark even when content is unchanged.
        this.db.prepare('UPDATE messages SET update_id=? WHERE chat_id=? AND message_id=?').run(update.update_id, chat, m.message_id);
        return { status: 'duplicate_message' };
      }
      this.db.prepare(`INSERT INTO messages VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,message_id) DO UPDATE SET
        text=excluded.text,version=excluded.version,update_id=excluded.update_id,reply_to=excluded.reply_to,retained_at=excluded.retained_at`)
        .run(chat, m.message_id, text, m.date, version, update.update_id, m.reply_to_message?.message_id ?? null, now);
      const name = (update.edited_message || update.edited_channel_post) ? 'message.edited' : 'message.created';
      const matching = this.subscriptions().filter(s => s.chat === chat && s.name === name && s.expires > now);
      const pending = Number(this.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n);
      if (pending + matching.length > this.config.maxJobs) throw new AppError('delivery_queue_full', 503);
      const event = { eventId: `evt_${randomUUID()}`, name, timestamp: new Date(version * 1000).toISOString(),
        data: { chat_id: chat, message_id: m.message_id, update_id: update.update_id }, cursor: null };
      for (const s of matching) this.db.prepare('INSERT INTO jobs(id,subscription_id,body,next_at,created) VALUES(?,?,?,?,?)')
        .run(`${event.eventId}:${s.id}`, s.id, JSON.stringify(event), now, now);
      return { status: 'accepted' };
    });
  }
  list(chat: string, before: number | undefined, limit: number, query?: string) {
    this.allowed(chat);
    const rows = this.db.prepare(`SELECT * FROM messages WHERE chat_id=? AND message_id<? AND retained_at>=?
      AND (? IS NULL OR instr(lower(text),lower(?))>0) ORDER BY message_id DESC LIMIT ?`)
      .all(chat, before ?? Number.MAX_SAFE_INTEGER, Date.now() - this.config.retentionDays * 86400000, query ?? null, query ?? null, limit + 1) as MessageRow[];
    return { messages: rows.slice(0, limit), next_before: rows.length > limit ? rows[limit - 1]!.message_id : null, untrusted: true };
  }
  context(chat: string, id: number, radius: number) {
    this.allowed(chat);
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    const target = this.db.prepare('SELECT * FROM messages WHERE chat_id=? AND message_id=? AND retained_at>=?').get(chat, id, cutoff);
    if (!target) throw new AppError('message_not_found', 404);
    const before = this.db.prepare('SELECT * FROM messages WHERE chat_id=? AND message_id<? AND retained_at>=? ORDER BY message_id DESC LIMIT ?').all(chat, id, cutoff, radius);
    const after = this.db.prepare('SELECT * FROM messages WHERE chat_id=? AND message_id>? AND retained_at>=? ORDER BY message_id LIMIT ?').all(chat, id, cutoff, radius);
    return { messages: [...before.reverse(), target, ...after], untrusted: true };
  }
  due(now: number): Job[] { return this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY next_at LIMIT 25").all(now) as Job[]; }
  maintain(now = Date.now()) {
    this.transaction(() => {
      const cutoff = now - this.config.retentionDays * 86400000;
      this.db.prepare('DELETE FROM messages WHERE retained_at<?').run(cutoff);
      this.db.prepare('DELETE FROM messages WHERE rowid IN (SELECT rowid FROM messages ORDER BY retained_at DESC LIMIT -1 OFFSET ?)').run(this.config.maxMessages);
      this.db.prepare('DELETE FROM updates WHERE created<?').run(cutoff);
      this.db.prepare('DELETE FROM updates WHERE id IN (SELECT id FROM updates ORDER BY created DESC LIMIT -1 OFFSET 100000)').run();
      this.db.prepare('DELETE FROM nonces WHERE created<?').run(now - 600000);
      this.db.prepare('DELETE FROM jobs WHERE created<?').run(cutoff);
      for (const s of this.subscriptions()) {
        if (s.expires <= now || !this.config.chats.includes(s.chat)) this.unsubscribe(s.id);
        else if (s.oldSecret && (s.rotateUntil ?? 0) <= now) {
          delete s.oldSecret; delete s.rotateUntil; this.saveSubscription(s);
        }
      }
    });
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  close() { this.db.close(); }
}
