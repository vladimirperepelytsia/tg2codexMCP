import { loadConfig } from './config.js';
import { createApp } from './app.js';

process.umask(0o077);
try {
  const config = loadConfig();
  const app = createApp(config);
  app.store.maintain();
  app.server.listen(config.port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'listening', port: config.port })));
  let work = Promise.resolve();
  let working = false;
  const timer = setInterval(() => {
    if (working) return;
    working = true;
    work = app.events.tick().catch(() => { console.error('{"event":"delivery_worker_error"}'); }).finally(() => { working = false; });
  }, 1000);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true; clearInterval(timer);
    await work;
    await app.close();
  };
  process.on('SIGTERM', () => { void stop(); });
  process.on('SIGINT', () => { void stop(); });
} catch { console.error('{"event":"startup_failed","hint":"Check configuration and database permissions"}'); process.exitCode = 1; }
