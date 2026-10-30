import { loadConfig } from './config.js';
import { startRuntime } from './runtime.js';
import { AppError } from './security.js';

process.umask(0o077);
// stdout is exclusively MCP JSON-RPC in stdio mode.
const report = (event: string) => console.error(JSON.stringify({ event }));
let stop: (() => Promise<void>) | undefined;
let stopping = false;
const onStop = () => { stopping = true; void stop?.(); };
process.on('SIGTERM', onStop);
process.on('SIGINT', onStop);
try {
  const runtime = await startRuntime(loadConfig(), { report, onFatal: () => { process.exitCode = 1; } });
  stop = runtime.close;
  if (stopping) await stop();
} catch (e) {
  report(e instanceof AppError ? e.code : 'startup_failed_check_configuration_database_and_port'); process.exitCode = 1;
}
