import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { TelegramError, TelegramPoller, telegramApi, type TelegramApi } from '../src/telegram.js';
import { Events, subscribeSchema } from '../src/events.js';

const config = () => ({ ...loadConfig({ INGESTION_MODE: 'offline', ALLOWED_CHAT_IDS: '-1001' }), dbPath: ':memory:' });
const update = (id: number, chat = -1001) => ({ update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: chat }, text: 'poll fixture' } });
const signal = () => new AbortController().signal;

test('standalone stdio configuration needs no MCP, adapter or Events credentials', () => {
  const c = loadConfig({ ALLOWED_CHAT_IDS: '-1001', TELEGRAM_BOT_TOKEN: '123:' + 'x'.repeat(24) });
  assert.equal(c.transport, 'stdio'); assert.equal(c.ingestion, 'polling'); assert.equal(c.eventsEnabled, false);
  assert.equal(c.readToken, ''); assert.equal(c.ingressSecret, '');
  assert.throws(() => loadConfig({ ALLOWED_CHAT_IDS: '-1001' }), /Polling requires/);
  assert.throws(() => loadConfig({ ALLOWED_CHAT_IDS: '-1001', INGESTION_MODE: 'offline', MCP_TRANSPORT: 'http' }), /HTTP requires/);
});
test('direct polling filters chats and persists acknowledgement across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg2-poll-')), c = { ...config(), dbPath: join(dir, 'state.sqlite') };
  let s = new Store(c); const requests: Record<string, unknown>[] = [];
  const call: TelegramApi = async (method, params) => {
    if (method === 'getMe') return { id: 123, is_bot: true };
    if (method === 'getWebhookInfo') return { url: '' };
    requests.push(params); return requests.length === 1 ? [update(10, -999), { update_id: 11, callback_query: {} }, update(12)] : [];
  };
  try {
    let p = new TelegramPoller(s, call); await p.prepare(signal()); await p.pollOnce(signal());
    assert.equal(s.pollOffset(), 13); assert.equal(s.list('-1001', undefined, 10).messages.length, 1);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM messages WHERE chat_id=?').get('-999')!.n, 0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM nonces').get()!.n, 0);
    s.close(); s = new Store(c); p = new TelegramPoller(s, call);
    await p.prepare(signal()); await p.pollOnce(signal());
    assert.equal(requests[0]!.offset, undefined); assert.equal(requests[1]!.offset, 13);
    assert.equal(requests[0]!.timeout, 25); assert.equal(requests[0]!.limit, 100);
    assert.deepEqual(requests[0]!.allowed_updates, ['message', 'edited_message', 'channel_post', 'edited_channel_post']);
    assert.equal(s.pollOffset(Date.now() + 8 * 86400000), undefined);
    assert.throws(() => s.bindBot('another-bot'), /different_bot/);
  } finally { s.close(); rmSync(dir, { recursive: true }); }
});
test('an existing webhook is refused without deleting it or polling', async () => {
  const s = new Store(config()), calls: string[] = [];
  try {
    const p = new TelegramPoller(s, async method => {
      calls.push(method); return method === 'getMe' ? { id: 123, is_bot: true } : { url: 'https://existing.example/webhook' };
    });
    await assert.rejects(p.run(signal(), () => {}), /telegram_webhook_already_configured/);
    assert.deepEqual(calls, ['getMe', 'getWebhookInfo']);
  } finally { s.close(); }
});
test('message/outbox failure never advances polling acknowledgement', async () => {
  const s = new Store({ ...config(), eventsEnabled: true, callbackHosts: ['receiver.example.com'], maxJobs: 0 });
  try {
    s.ingestPolled({ update_id: 10 });
    await new Events(s, async (_url, body) => ({ status: 200, body: JSON.stringify({ challenge: JSON.parse(body).challenge }) })).subscribe(subscribeSchema.parse({
      name: 'message.created', arguments: { chat_id: '-1001' }, delivery: { mode: 'webhook', url: 'https://receiver.example.com/events', secret: 'whsec_' + Buffer.alloc(32, 7).toString('base64') },
    }));
    const p = new TelegramPoller(s, async () => [update(11)]);
    await assert.rejects(p.pollOnce(signal()), /delivery_queue_full/);
    assert.equal(s.pollOffset(), 11); assert.equal(s.list('-1001', undefined, 10).messages.length, 0);
    s.config.maxJobs = 10; await p.pollOnce(signal());
    assert.equal(s.pollOffset(), 12); assert.equal(s.list('-1001', undefined, 10).messages.length, 1);
  } finally { s.close(); }
});
test('invalid/out-of-order updates fail closed without skipping uncommitted work', async () => {
  const s = new Store(config());
  try {
    await assert.rejects(new TelegramPoller(s, async () => [update(2), update(1)]).pollOnce(signal()), /invalid_update_order/);
    assert.equal(s.pollOffset(), undefined);
    await assert.rejects(new TelegramPoller(s, async () => [update(1), { update_id: 2, message: {} }, update(3)]).pollOnce(signal()));
    assert.equal(s.pollOffset(), 2); assert.equal(s.list('-1001', undefined, 10).messages.length, 1);
  } finally { s.close(); }
});
test('Telegram API errors are sanitized; retry_after and conflicts are classified', async () => {
  const controller = new AbortController();
  const api = telegramApi('fixture', async (_url, _body, _headers, passed) => {
    assert.equal(passed, controller.signal);
    return { status: 429, body: '{"ok":false,"error_code":429,"description":"private text","parameters":{"retry_after":7}}' };
  });
  await assert.rejects(api('getUpdates', {}, controller.signal), (e: unknown) => e instanceof TelegramError && e.retryAfterMs === 7000 && !e.fatal && !e.message.includes('private'));
  const conflict = telegramApi('fixture', async () => ({ status: 409, body: '{"ok":false,"error_code":409}' }));
  await assert.rejects(conflict('getUpdates', {}, signal()), (e: unknown) => e instanceof TelegramError && e.fatal);
});
test('polling retries with bounded backoff and aborts without spinning', async () => {
  const s = new Store(config()), controller = new AbortController(), delays: number[] = [];
  let calls = 0;
  try {
    const p = new TelegramPoller(s, async method => {
      if (method === 'getMe') return { id: 123, is_bot: true };
      if (method === 'getWebhookInfo') return { url: '' };
      calls++; throw new TelegramError('telegram_api_429', 7000);
    }, async (ms) => { delays.push(ms); if (delays.length === 2) controller.abort(); });
    await p.run(controller.signal, () => {});
    assert.deepEqual(delays, [7000, 7000]); assert.equal(calls, 2);
  } finally { s.close(); }
});
test('v1 database migration preserves retained data and rejects unknown newer schemas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg2-migrate-')), c = { ...config(), dbPath: join(dir, 'state.sqlite') };
  let s = new Store(c); s.ingestPolled(update(1)); s.close();
  const legacy = new DatabaseSync(c.dbPath); legacy.exec('DROP TABLE metadata; PRAGMA user_version=1'); legacy.close();
  try {
    s = new Store(c); assert.equal(s.list('-1001', undefined, 10).messages.length, 1); assert.equal(s.pollOffset(), undefined);
    assert.equal(s.db.prepare('PRAGMA user_version').get()!.user_version, 2); s.close();
    const future = new DatabaseSync(c.dbPath); future.exec('PRAGMA user_version=99'); future.close();
    assert.throws(() => new Store(c), /unsupported_database_version/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('disabled Events do not create or deliver jobs left by earlier configuration', async () => {
  const s = new Store({ ...config(), eventsEnabled: true, callbackHosts: ['receiver.example.com'] }); let calls = 0;
  const e = new Events(s, async (_url, body) => { calls++; return { status: 200, body: JSON.stringify({ challenge: JSON.parse(body).challenge }) }; });
  try {
    const p = subscribeSchema.parse({ name: 'message.created', arguments: { chat_id: '-1001' }, delivery: { mode: 'webhook', url: 'https://receiver.example.com/events', secret: 'whsec_' + Buffer.alloc(32, 7).toString('base64') } });
    await e.subscribe(p); s.ingestPolled(update(1)); assert.equal(s.due(Date.now()).length, 1);
    s.config.eventsEnabled = false; s.ingestPolled(update(2)); await e.tick();
    assert.equal(s.due(Date.now()).length, 1); assert.equal(calls, 1);
    await assert.rejects(e.subscribe(p), /events_disabled/);
  } finally { s.close(); }
});
