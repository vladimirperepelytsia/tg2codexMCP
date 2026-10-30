import { z } from 'zod';

export const chatId = z.string().regex(/^-?[1-9]\d{0,15}$/);
const secret = z.string().min(32).refine(v => !v.includes('REPLACE'), 'Replace placeholder secrets');
const botToken = z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/).refine(v => !v.includes('REPLACE'), 'Replace bot token');
const csv = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const transport = z.enum(['stdio', 'http']).parse(env.MCP_TRANSPORT ?? 'stdio');
  const ingestion = z.enum(['polling', 'offline', 'adapter']).parse(env.INGESTION_MODE ?? 'polling');
  const readToken = env.MCP_TOKEN ? secret.parse(env.MCP_TOKEN) : '';
  const ingressSecret = env.INGRESS_SECRET ? secret.parse(env.INGRESS_SECRET) : '';
  const sendToken = env.MCP_SEND_TOKEN ? secret.parse(env.MCP_SEND_TOKEN) : undefined;
  const tokens = [readToken, ingressSecret, sendToken].filter(Boolean);
  if (new Set(tokens).size !== tokens.length) throw new Error('Use different secrets for ingress, read, and send');
  if (transport === 'http' && !readToken) throw new Error('HTTP requires MCP_TOKEN');
  if (ingestion === 'adapter' && (transport !== 'http' || !ingressSecret)) throw new Error('Adapter ingress requires HTTP and INGRESS_SECRET');
  const chats = z.array(chatId).min(1).parse(csv(env.ALLOWED_CHAT_IDS));
  const sendChats = z.array(chatId).parse(csv(env.SEND_CHAT_IDS));
  if (sendChats.some(id => !chats.includes(id))) throw new Error('Send chats must be readable');
  const sending = env.ENABLE_SEND === 'true';
  const token = env.TELEGRAM_BOT_TOKEN ? botToken.parse(env.TELEGRAM_BOT_TOKEN) : undefined;
  if (ingestion === 'polling' && !token) throw new Error('Polling requires TELEGRAM_BOT_TOKEN');
  if (sending && (!token || !sendChats.length || (transport === 'http' && !sendToken))) throw new Error('Sending requires bot token, send allowlist and HTTP send credential where applicable');
  const eventsEnabled = env.ENABLE_EVENTS === 'true';
  if (eventsEnabled && transport !== 'http') throw new Error('Events require HTTP transport');
  const hosts = csv(env.CALLBACK_HOSTS);
  if (hosts.some(h => !/^[a-z0-9.-]+$/.test(h) || h.includes('*'))) throw new Error('Use exact callback hostnames');
  return {
    transport, ingestion, eventsEnabled, readToken, ingressSecret, sendToken, chats, sendChats, sending,
    botToken: token, callbackHosts: hosts,
    port: z.coerce.number().int().min(1).max(65535).parse(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? './data/connector.sqlite',
    retentionDays: z.coerce.number().int().min(1).max(90).parse(env.RETENTION_DAYS ?? 7),
    maxMessages: 50_000, maxJobs: 10_000, maxSubscriptions: 100,
  };
}
export type Config = ReturnType<typeof loadConfig>;
