import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { startRuntime } from '../src/runtime.js';

const config = () => ({ ...loadConfig({ INGESTION_MODE: 'offline', ALLOWED_CHAT_IDS: '-1001' }), dbPath: ':memory:' });
const main = resolve('src/main.ts');
const seed = (s: Store) => s.ingestPolled({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: -1001 }, text: 'interop fixture' } });

test('official MCP v1 client discovers and calls tools over stdio without Events', { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg2-stdio-')), dbPath = join(dir, 'state.sqlite');
  const s = new Store({ ...config(), dbPath }); seed(s); s.close();
  const client = new Client({ name: 'fixture-v1', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', main], cwd: process.cwd(),
    env: { INGESTION_MODE: 'offline', MCP_TRANSPORT: 'stdio', ENABLE_EVENTS: 'false', ENABLE_SEND: 'false', ALLOWED_CHAT_IDS: '-1001', DB_PATH: dbPath }, stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    assert.equal('events' in client.getServerCapabilities()!, false);
    assert.equal((await client.listTools()).tools.length, 3);
    const result = await client.callTool({ name: 'telegram_messages', arguments: { chat_id: '-1001' } });
    assert.ok(JSON.stringify(result).includes('interop fixture'));
    const denied = await client.callTool({ name: 'telegram_context', arguments: { chat_id: '-999', message_id: 1 } });
    assert.equal(denied.isError, true);
  } finally {
    await client.close(); assert.equal(existsSync(dbPath + '.lock'), false);
    rmSync(dir, { recursive: true });
  }
});
test('official MCP v1 client uses authenticated Streamable HTTP without Events', { timeout: 10000 }, async () => {
  const c = { ...config(), transport: 'http' as const, readToken: 'r'.repeat(40) }, app = createApp(c);
  seed(app.store);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); assert.ok(addr && typeof addr !== 'string');
  const url = new URL(`http://127.0.0.1:${addr.port}/mcp`), client = new Client({ name: 'fixture-v1', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${c.readToken}` } } }));
    assert.equal((await client.listTools()).tools.length, 3);
    assert.equal('events' in client.getServerCapabilities()!, false);
    const result = await client.callTool({ name: 'telegram_search', arguments: { chat_id: '-1001', query: 'fixture' } });
    assert.ok(JSON.stringify(result).includes('interop fixture'));
    assert.equal((await fetch(new URL('/ingress/telegram', url), { method: 'POST' })).status, 404);
  } finally { await client.close(); await app.close(); }
});
test('MCP 2 stdio discovers standard tools without advertising dot Events', { timeout: 5000 }, async () => {
  const input = new PassThrough(), output = new PassThrough();
  const runtime = await startRuntime(config(), { input, output });
  try {
    const data = once(output, 'data');
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {}, [CLIENT_INFO_META_KEY]: { name: 'fixture-v2', version: '1' },
    } } }) + '\n');
    const [bytes] = await data; const reply = JSON.parse(bytes.toString());
    assert.equal(reply.error, undefined, JSON.stringify(reply));
    assert.ok(reply.result.capabilities.tools); assert.equal(reply.result.capabilities.events, undefined);
  } finally { await runtime.close(); }
});
test('stdio EOF aborts an in-flight Telegram poll, releases lock, and allows restart', { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg2-runtime-')), dbPath = join(dir, 'state.sqlite');
  const c = { ...config(), dbPath, ingestion: 'polling' as const, botToken: 'fixture' };
  const input = new PassThrough(), output = new PassThrough(); let cancelled = false;
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  const runtime = await startRuntime(c, { input, output, callTelegram: async (method, _params, signal) => {
    if (method === 'getMe') return { id: 123, is_bot: true };
    if (method === 'getWebhookInfo') return { url: '' };
    began(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('aborted')); }, { once: true }));
  } });
  try {
    await started;
    await assert.rejects(startRuntime(c, { input: new PassThrough(), output: new PassThrough() }), /database_locked/);
    input.resume(); input.end(); await once(input, 'end'); await runtime.close();
    assert.equal(cancelled, true); assert.equal(existsSync(dbPath + '.lock'), false);
    const next = await startRuntime({ ...c, ingestion: 'offline' }, { input: new PassThrough(), output: new PassThrough() });
    await next.close();
  } finally { await runtime.close(); rmSync(dir, { recursive: true }); }
});
test('HTTP listen failure rolls back startup without leaving a database lock', { timeout: 5000 }, async () => {
  const blocker = createServer(); await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const address = blocker.address(); assert.ok(address && typeof address !== 'string');
  const dir = mkdtempSync(join(tmpdir(), 'tg2-bind-')), dbPath = join(dir, 'state.sqlite');
  try {
    await assert.rejects(startRuntime({ ...config(), dbPath, transport: 'http', readToken: 'r'.repeat(40), port: address.port }));
    assert.equal(existsSync(dbPath + '.lock'), false);
  } finally { await new Promise<void>(resolve => blocker.close(() => resolve())); rmSync(dir, { recursive: true }); }
});
for (const stop of ['EOF', 'SIGINT', 'SIGTERM'] as const) test(`entrypoint keeps stdout protocol-only and exits cleanly on ${stop}`, { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg2-process-')), dbPath = join(dir, 'state.sqlite');
  const child = spawn(process.execPath, ['--import', 'tsx', main], { cwd: process.cwd(), env: {
    PATH: process.env.PATH, INGESTION_MODE: 'offline', MCP_TRANSPORT: 'stdio', ENABLE_EVENTS: 'false', ENABLE_SEND: 'false', ALLOWED_CHAT_IDS: '-1001', DB_PATH: dbPath,
  }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines: string[] = []; let buffer = '';
  child.stdout.on('data', bytes => { buffer += bytes; const parts = buffer.split('\n'); buffer = parts.pop()!; lines.push(...parts); });
  try {
    const response = once(child.stdout, 'data');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'lifecycle', version: '1' } } }) + '\n');
    await response; const exit = once(child, 'exit');
    if (stop === 'EOF') child.stdin.end(); else child.kill(stop);
    const [code] = await exit; assert.equal(code, 0);
    assert.ok(lines.length >= 1); for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, '2.0');
    assert.equal(existsSync(dbPath + '.lock'), false);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); rmSync(dir, { recursive: true }); }
});

test('HTTP send scope remains separate for legacy clients and actual sends are idempotent', { timeout: 10000 }, async () => {
  const c = { ...config(), transport: 'http' as const, readToken: 'r'.repeat(40), sendToken: 'w'.repeat(40), sending: true, botToken: 'fixture', sendChats: ['-1001'] };
  let sent = 0;
  const app = createApp(c, { telegramPost: async () => { sent++; return { status: 200, body: '{"ok":true,"result":{"message_id":9}}' }; } });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const reader = new Client({ name: 'reader', version: '1' }), writer = new Client({ name: 'writer', version: '1' });
  const args = { chat_id: '-1001', text: 'fixture send', confirmed: true, idempotency_key: 'interop-send-key-1234' };
  try {
    await reader.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${c.readToken}` } } }));
    await writer.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${c.sendToken}` } } }));
    assert.equal((await reader.listTools()).tools.some(t => t.name === 'telegram_send'), false);
    await assert.rejects(reader.callTool({ name: 'telegram_send', arguments: args }), /not found/);
    assert.equal(sent, 0);
    assert.equal((await writer.listTools()).tools.some(t => t.name === 'telegram_send'), true);
    assert.equal((await writer.callTool({ name: 'telegram_send', arguments: { ...args, confirmed: false } })).isError, true);
    const first = await writer.callTool({ name: 'telegram_send', arguments: args });
    assert.notEqual(first.isError, true);
    await writer.callTool({ name: 'telegram_send', arguments: args }); assert.equal(sent, 1);
  } finally { await reader.close(); await writer.close(); await app.close(); }
});
