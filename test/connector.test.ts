import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server';
import { loadConfig } from '../src/config.js';
import { callbackUrl, publicAddress, safePost, verifyIngress, type Post } from '../src/security.js';
import { Store } from '../src/store.js';
import { Events, signedHeaders, subscribeSchema } from '../src/events.js';
import { Sender } from '../src/send.js';
import { createApp } from '../src/app.js';

const config = () => ({ ...loadConfig({ MCP_TOKEN: 'r'.repeat(40), INGRESS_SECRET: 'i'.repeat(40), ALLOWED_CHAT_IDS: '-1001', CALLBACK_HOSTS: 'receiver.example.com' }), dbPath: ':memory:' });
const now = Math.floor(Date.now() / 1000);
const update = (id = 1, text = 'fixture error', mid = id) => ({ update_id: id, message: { message_id: mid, chat: { id: -1001 }, date: now, text } });
const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const subscription = () => subscribeSchema.parse({ name: 'message.created', arguments: { chat_id: '-1001' }, delivery: { mode: 'webhook', url: 'https://receiver.example.com/events', secret } });
const echo: Post = async (_url, body) => ({ status: 200, body: JSON.stringify({ challenge: JSON.parse(body).challenge }) });

test('configuration fails closed and separates roles', () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() => loadConfig({ MCP_TOKEN: 'x'.repeat(40), INGRESS_SECRET: 'x'.repeat(40), ALLOWED_CHAT_IDS: '-1001' }));
  assert.equal(config().sending, false);
});
test('ingress signature binds bytes, nonce and timestamp', () => {
  const body = JSON.stringify(update()), timestamp = String(now), nonce = randomUUID();
  const sign = 'v1=' + createHmac('sha256', config().ingressSecret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  verifyIngress(body, timestamp, nonce, sign, config().ingressSecret);
  for (const [b, t, n] of [[body + ' ', timestamp, nonce], [body, '1000000000', nonce], [body, timestamp, 'short']]) {
    assert.throws(() => verifyIngress(b!, t!, n!, sign, config().ingressSecret));
  }
});
test('duplicate updates, replay and edits cannot overwrite newer text', () => {
  const s = new Store(config());
  try {
    assert.equal(s.ingest(update(), 'nonce-1').status, 'accepted');
    assert.equal(s.ingest(update(), 'nonce-2').status, 'duplicate');
    assert.throws(() => s.ingest(update(), 'nonce-1'), /replayed_request/);
    const edited = { update_id: 3, edited_message: { ...update().message, text: 'fixed', edit_date: now + 1 } };
    s.ingest(edited, 'nonce-3');
    assert.equal(s.ingest(update(2, 'stale', 1), 'nonce-4').status, 'stale');
    assert.equal(s.list('-1001', undefined, 10).messages[0]!.text, 'fixed');
    s.ingest({ ...edited, update_id: 6 }, 'same-body-new-update');
    assert.equal(s.ingest({ ...edited, update_id: 5, edited_message: { ...edited.edited_message, text: 'intermediate' } }, 'delayed-intermediate').status, 'stale');
    assert.equal(s.list('-1001', undefined, 10).messages[0]!.text, 'fixed');
    assert.throws(() => s.ingest({ update_id: 4, message: { ...update().message, chat: { id: -999 } } }, 'nonce-5'), /chat_not_allowed/);
  } finally { s.close(); }
});
test('literal search, keyset pages, bounded context and denied scopes', () => {
  const s = new Store(config());
  try {
    for (let i = 1; i <= 5; i++) s.ingest(update(i, i === 2 ? '%_ literal' : 'text'), String(i));
    const first = s.list('-1001', undefined, 2);
    assert.deepEqual(first.messages.map(m => m.message_id), [5, 4]);
    assert.deepEqual(s.list('-1001', first.next_before!, 2).messages.map(m => m.message_id), [3, 2]);
    assert.deepEqual(s.list('-1001', undefined, 10, '%_').messages.map(m => m.message_id), [2]);
    assert.equal(s.context('-1001', 3, 1).messages.length, 3);
    assert.throws(() => s.list('-999', undefined, 10), /chat_not_allowed/);
    assert.throws(() => s.context('-1001', 99, 1), /message_not_found/);
  } finally { s.close(); }
});
test('subscription challenge, identity, TTL and refresh signing-key rotation', async () => {
  const s = new Store(config()); let calls = 0;
  const e = new Events(s, async (url, body, headers) => {
    calls++; new Webhook(secret).verify(body, headers); return echo(url, body, headers);
  });
  try {
    const p = subscription(), first = await e.subscribe(p);
    assert.equal((await e.subscribe(p)).id, first.id); assert.equal(calls, 1);
    assert.ok(Date.parse(first.refreshBefore) <= Date.now() + 86400000);
    const rotated = 'whsec_' + Buffer.alloc(32, 9).toString('base64');
    const e2 = new Events(s, echo);
    await e2.subscribe({ ...p, delivery: { ...p.delivery, secret: rotated }, ttlMs: 5000 });
    const current = s.subscriptions()[0]!;
    const body = '{}', headers = signedHeaders(current, 'evt_test', body, Date.now());
    new Webhook(secret).verify(body, headers); new Webhook(rotated).verify(body, headers);
    e.unsubscribe({ ...p, delivery: { mode: 'webhook', url: p.delivery.url } });
    e.unsubscribe({ ...p, delivery: { mode: 'webhook', url: p.delivery.url } });
    assert.equal(s.subscriptions().length, 0);
  } finally { s.close(); }
});
test('failed callback verification does not activate subscription', async () => {
  const s = new Store(config());
  try {
    const e = new Events(s, async () => ({ status: 200, body: '{"challenge":"wrong"}' }));
    await assert.rejects(e.subscribe(subscription()), (err: unknown) => err instanceof Error && 'code' in err && err.code === -32015);
    assert.equal(s.subscriptions().length, 0);
    assert.throws(() => subscribeSchema.parse({ ...subscription(), delivery: { ...subscription().delivery, secret: 'whsec_YQ==' } }));
  } finally { s.close(); }
});
test('outbox is atomic, durable, signed and retries stable event IDs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg2-test-'));
  const c = { ...config(), dbPath: join(dir, 'test.sqlite') };
  let s = new Store(c);
  try {
    await new Events(s, echo).subscribe(subscription());
    s.ingest(update(), 'one'); s.close(); s = new Store(c);
    const ids: string[] = []; let calls = 0;
    const e = new Events(s, async (_url, body, headers) => {
      new Webhook(secret).verify(body, headers); ids.push(headers['webhook-id']!); calls++;
      assert.equal(JSON.parse(body).data.text, undefined);
      return { status: calls === 1 ? 503 : 200, body: '' };
    });
    await e.tick();
    assert.equal(s.db.prepare('SELECT attempts FROM jobs').get()!.attempts, 1);
    s.db.prepare('UPDATE jobs SET next_at=0').run();
    await e.tick();
    assert.equal(ids[0], ids[1]); assert.equal(s.due(Date.now()).length, 0);
  } finally { s.close(); rmSync(dir, { recursive: true }); }
});
test('queue overflow rolls back message, update and nonce for retry', async () => {
  const s = new Store({ ...config(), maxJobs: 0 });
  try {
    await new Events(s, echo).subscribe(subscription());
    assert.throws(() => s.ingest(update(), 'nonce'), /delivery_queue_full/);
    assert.equal(s.list('-1001', undefined, 10).messages.length, 0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM updates').get()!.n, 0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM nonces').get()!.n, 0);
  } finally { s.close(); }
});
for (const status of [410, 413, 400]) test(`delivery status ${status} is not retried`, async () => {
  const s = new Store(config());
  try {
    await new Events(s, echo).subscribe(subscription()); s.ingest(update(), 'nonce');
    await new Events(s, async () => ({ status, body: '' })).tick();
    assert.equal(s.due(Date.now() + 86400000).length, 0);
    if (status === 410) assert.equal(s.subscriptions().length, 0);
  } finally { s.close(); }
});
test('expiration, revoke and retention remove queued delivery and retained data', async () => {
  const s = new Store({ ...config(), maxMessages: 1 });
  try {
    await new Events(s, echo).subscribe(subscription());
    s.ingest(update(), 'n1'); s.ingest(update(2), 'n2'); s.maintain();
    assert.equal(s.list('-1001', undefined, 10).messages.length, 1);
    s.config.chats = []; s.maintain(); assert.equal(s.subscriptions().length, 0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 0);
    s.maintain(Date.now() + 8 * 86400000);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM messages').get()!.n, 0);
  } finally { s.close(); }
});
test('callback destinations reject SSRF targets and redirects are never followed', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '192.0.2.1', '0.0.0.0', '224.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['http://receiver.example.com', 'https://user:pass@receiver.example.com', 'https://receiver.example.com:444/', 'https://evil.example.com/', 'https://receiver.example.com/#x']) assert.throws(() => callbackUrl(url, config().callbackHosts));
  await assert.rejects(safePost(['127.0.0.1'])('https://127.0.0.1/', '{}', {}), /non_public_callback/);
});
test('send is disabled by default, deduplicates successes and never retries unknown outcomes', async () => {
  const s = new Store({ ...config(), sending: true, botToken: 'fixture', sendChats: ['-1001'] }); let calls = 0;
  const p = { chat_id: '-1001', text: 'fixture', confirmed: true as const, idempotency_key: 'fixture-key-123456' };
  try {
    const sender = new Sender(s, async () => { calls++; return { status: 200, body: '{"ok":true,"result":{"message_id":9}}' }; });
    await assert.rejects(sender.send(p, false), /send_not_allowed/);
    await sender.send(p, true); await sender.send(p, true); assert.equal(calls, 1);
    await assert.rejects(sender.send({ ...p, text: 'different' }, true), /idempotency_conflict/);
    const uncertain = new Sender(s, async () => { calls++; throw new Error('timeout'); });
    const p2 = { ...p, idempotency_key: 'fixture-key-unknown' };
    await assert.rejects(uncertain.send(p2, true), /send_outcome_unknown/);
    await assert.rejects(uncertain.send(p2, true), /send_outcome_unknown/); assert.equal(calls, 2);
  } finally { s.close(); }
});
test('HTTP authentication, signed ingress and MCP 2 discovery/tools/events work together', async () => {
  const c = config(), app = createApp(c, { eventPost: echo });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); assert.ok(addr && typeof addr !== 'string');
  const base = `http://127.0.0.1:${addr.port}`;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const r = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}), accept: 'application/json, text/event-stream', authorization: `Bearer ${c.readToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {}, [CLIENT_INFO_META_KEY]: { name: 'fixture-client', version: '1' } } } }) });
    const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data;
  };
  try {
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(base + '/healthz', { headers: { origin: 'https://evil.example' } })).status, 403);
    const body = JSON.stringify(update()), timestamp = String(now), nonce = randomUUID();
    const signature = 'v1=' + createHmac('sha256', c.ingressSecret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
    const headers = { 'content-type': 'application/json', 'x-ingress-timestamp': timestamp, 'x-ingress-nonce': nonce, 'x-ingress-signature': signature };
    assert.equal((await fetch(base + '/ingress/telegram', { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(base + '/ingress/telegram', { method: 'POST', headers, body })).status, 409);
    const discovery = await rpc('server/discover');
    assert.equal(discovery.error, undefined, JSON.stringify(discovery));
    assert.deepEqual(discovery.result.capabilities.events, {});
    assert.ok(discovery.result.supportedVersions.includes('2026-07-28'));
    const list = await rpc('tools/list'); assert.equal(list.result.tools.length, 3);
    const messages = await rpc('tools/call', { name: 'telegram_messages', arguments: { chat_id: '-1001' } });
    assert.equal(messages.error, undefined, JSON.stringify(messages));
    assert.ok(JSON.stringify(messages).includes('fixture error'));
    const events = await rpc('events/list'); assert.equal(events.error, undefined, JSON.stringify(events));
    assert.equal(events.result.events.length, 2);
    const sub = await rpc('events/subscribe', subscription());
    assert.equal(sub.error, undefined, JSON.stringify(sub)); assert.ok(sub.result.id.startsWith('sub_'));
    const invalid = await rpc('events/subscribe', { ...subscription(), arguments: { chat_id: '-999' } });
    assert.ok(invalid.error);
  } finally { await app.close(); }
});

test('edited events are separately filtered and expired subscriptions receive nothing', async () => {
  const s = new Store(config());
  try {
    const e = new Events(s, echo), p = subscription();
    await e.subscribe({ ...p, name: 'message.edited' });
    s.ingest(update(), 'created'); assert.equal(s.due(Date.now()).length, 0);
    s.ingest({ update_id: 2, edited_message: { ...update().message, text: 'edited', edit_date: now + 1 } }, 'edited');
    assert.equal(s.due(Date.now()).length, 1);
    const stored = s.subscriptions()[0]!;
    s.saveSubscription({ ...stored, expires: Date.now() - 1 });
    let calls = 0;
    await new Events(s, async () => { calls++; return { status: 200, body: '' }; }).tick();
    assert.equal(calls, 0); assert.equal(s.subscriptions().length, 0);
  } finally { s.close(); }
});
test('bounded retries end in dead state and rotated keys are removed after overlap', async () => {
  const s = new Store(config());
  try {
    const e = new Events(s, echo); await e.subscribe(subscription());
    const p = subscription();
    await e.subscribe({ ...p, delivery: { ...p.delivery, secret: 'whsec_' + Buffer.alloc(32, 1).toString('base64') } });
    const current = s.subscriptions()[0]!;
    s.saveSubscription({ ...current, rotateUntil: Date.now() - 1 });
    s.maintain(); assert.equal(s.subscriptions()[0]!.oldSecret, undefined);
    s.ingest(update(), 'nonce');
    const failed = new Events(s, async () => ({ status: 429, body: '' }));
    for (let i = 0; i < 8; i++) { s.db.prepare('UPDATE jobs SET next_at=0').run(); await failed.tick(); }
    assert.equal(s.db.prepare('SELECT state FROM jobs').get()!.state, 'dead');
    assert.equal(s.db.prepare('SELECT attempts FROM jobs').get()!.attempts, 8);
  } finally { s.close(); }
});

test('unsubscribe during callback verification cannot resurrect a subscription', async () => {
  const s = new Store(config());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const e = new Events(s, async (url, body, headers) => { await gate; return echo(url, body, headers); });
  try {
    const p = subscription(), pending = e.subscribe(p);
    e.unsubscribe({ ...p, delivery: { mode: 'webhook', url: p.delivery.url } });
    release(); await assert.rejects(pending, /subscription_superseded/);
    assert.equal(s.subscriptions().length, 0);
  } finally { s.close(); }
});
