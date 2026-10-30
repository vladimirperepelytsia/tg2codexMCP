import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Readable, Writable } from 'node:stream';
import { createApp } from './app.js';
import type { Config } from './config.js';
import { Events } from './events.js';
import { lockDatabase } from './lock.js';
import { createMcpServer } from './mcp.js';
import { AppError, safePost } from './security.js';
import { Sender } from './send.js';
import { Store } from './store.js';
import { telegramApi, TelegramPoller, type TelegramApi } from './telegram.js';

export async function startRuntime(config: Config, options: {
  input?: Readable; output?: Writable; callTelegram?: TelegramApi;
  report?: (code: string) => void; onFatal?: () => void;
} = {}) {
  const report = options.report ?? (() => {});
  const unlock = lockDatabase(config.dbPath);
  let store: Store;
  try { store = new Store(config); store.maintain(); } catch (e) { unlock(); throw e; }
  const abort = new AbortController();
  const callbacks = safePost(config.callbackHosts), telegram = safePost(['api.telegram.org']);
  const eventPost: typeof callbacks = (url, body, headers) => callbacks(url, body, headers, abort.signal);
  const telegramPost: typeof telegram = (url, body, headers) => telegram(url, body, headers, abort.signal);
  const events = new Events(store, eventPost), sender = new Sender(store, telegramPost);
  let closeTransport: () => Promise<void> = async () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let worker = Promise.resolve(), working = false, polling = Promise.resolve();
  let closing: Promise<void> | undefined;
  const input = options.input ?? process.stdin;
  const onEnd = () => { void close(); };
  function close(): Promise<void> {
    if (closing) return closing;
    abort.abort(); clearInterval(timer); input.off('end', onEnd); input.off('close', onEnd);
    closing = (async () => {
      try { await closeTransport(); await polling; await worker; }
      finally { store.close(); unlock(); }
    })();
    return closing;
  }
  try {
    if (config.transport === 'http') {
      const app = createApp(config, { store, eventPost, telegramPost });
      closeTransport = () => app.close();
      await new Promise<void>((resolve, reject) => {
        app.server.once('error', reject);
        app.server.listen(config.port, '127.0.0.1', () => { app.server.off('error', reject); resolve(); });
      });
    } else {
      const handle = serveStdio(ctx => createMcpServer(store, events, sender, config.sending, ctx.era === 'modern'), {
        legacy: 'serve', transport: new StdioServerTransport(input, options.output ?? process.stdout, { maxBufferSize: 262144 }),
        onerror: () => { report('mcp_stdio_error'); void close(); },
      });
      closeTransport = () => handle.close();
      input.once('end', onEnd); input.once('close', onEnd);
    }
    timer = setInterval(() => {
      if (working || abort.signal.aborted) return;
      working = true;
      worker = (config.eventsEnabled ? events.tick() : Promise.resolve().then(() => store.maintain()))
        .catch(() => report('maintenance_or_delivery_error')).finally(() => { working = false; });
    }, 1000);
    if (config.ingestion === 'polling') {
      const poller = new TelegramPoller(store, options.callTelegram ?? telegramApi(config.botToken!));
      polling = poller.run(abort.signal, report).catch(e => {
        report(e instanceof AppError ? e.code : 'telegram_polling_failed');
        options.onFatal?.();
        // Schedule teardown after this promise settles to avoid waiting on itself.
        queueMicrotask(() => { void close(); });
      });
    }
    if (input.readableEnded && config.transport === 'stdio') queueMicrotask(onEnd);
    return { store, close };
  } catch (e) { await close(); throw e; }
}
