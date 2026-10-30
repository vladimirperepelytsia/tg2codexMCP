import { createServer, type IncomingMessage } from 'node:http';
import { localhostHostValidation, toNodeHandler } from '@modelcontextprotocol/node';
import type { Config } from './config.js';
import { Events } from './events.js';
import { mcpHandler } from './mcp.js';
import { AppError, equal, safePost, verifyIngress, type Post } from './security.js';
import { Sender } from './send.js';
import { Store } from './store.js';
import { ZodError } from 'zod';

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) throw new AppError('body_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createApp(config: Config, deps: { eventPost?: Post; telegramPost?: Post; store?: Store } = {}) {
  const store = deps.store ?? new Store(config);
  const events = new Events(store, deps.eventPost ?? safePost(config.callbackHosts));
  const sender = new Sender(store, deps.telegramPost ?? safePost(['api.telegram.org']));
  const readMcp = mcpHandler(store, events, sender, false), sendMcp = mcpHandler(store, events, sender, true);
  const readHandler = toNodeHandler(readMcp), sendHandler = toNodeHandler(sendMcp);
  const hostGuard = localhostHostValidation();
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (!hostGuard(req, res)) return;
    try {
      // This is a server-to-server endpoint; browser origins are not supported.
      if (req.headers.origin) throw new AppError('origin_not_allowed', 403);
      if (req.url === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'); return;
      }
      if (req.method !== 'POST') throw new AppError('method_not_allowed', 405);
      if (req.url !== '/mcp' && !(req.url === '/ingress/telegram' && config.ingestion === 'adapter')) throw new AppError('not_found', 404);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('json_required', 415);
      let canSend = false;
      if (req.url === '/mcp') {
        const auth = req.headers.authorization ?? '';
        canSend = Boolean(config.sendToken && equal(auth, `Bearer ${config.sendToken}`));
        if (!canSend && !equal(auth, `Bearer ${config.readToken}`)) throw new AppError('unauthorized', 401);
      }
      const raw = await readBody(req);
      if (req.url === '/ingress/telegram') {
        const header = (name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : '';
        const nonce = header('x-ingress-nonce');
        verifyIngress(raw, header('x-ingress-timestamp'), nonce, header('x-ingress-signature'), config.ingressSecret);
        const result = store.ingest(JSON.parse(raw), nonce);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      } else await (canSend ? sendHandler : readHandler)(req, res, JSON.parse(raw));
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      const status = e instanceof AppError ? e.status : e instanceof SyntaxError || e instanceof ZodError ? 400 : 500;
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e instanceof AppError ? e.code : status === 400 ? 'invalid_payload' : 'internal_error' }));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 100;
  return { server, store, events, async close() {
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close(e => e ? reject(e) : resolve()); server.closeAllConnections();
    });
    await readMcp.close(); await sendMcp.close();
    if (!deps.store) store.close();
  } };
}
