import { z } from 'zod';

export const chatId = z.string().regex(/^-?[1-9]\d{0,15}$/);
const secret = z.string().min(32).refine(v => !v.includes('REPLACE'), 'Replace placeholder secrets');
const csv = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const readToken = secret.parse(env.MCP_TOKEN);
  const ingressSecret = secret.parse(env.INGRESS_SECRET);
  const sendToken = env.MCP_SEND_TOKEN ? secret.parse(env.MCP_SEND_TOKEN) : undefined;
  if (new Set([readToken, ingressSecret, sendToken].filter(Boolean)).size !== (sendToken ? 3 : 2)) {
    throw new Error('Use different secrets for ingress, read, and send');
  }
  const chats = z.array(chatId).min(1).parse(csv(env.ALLOWED_CHAT_IDS));
  const sendChats = z.array(chatId).parse(csv(env.SEND_CHAT_IDS));
  if (sendChats.some(id => !chats.includes(id))) throw new Error('Send chats must be readable');
  const sending = env.ENABLE_SEND === 'true';
  if (sending && (!sendToken || !env.TELEGRAM_BOT_TOKEN || !sendChats.length)) throw new Error('Sending requires token and send allowlist');
  const hosts = csv(env.CALLBACK_HOSTS);
  if (hosts.some(h => !/^[a-z0-9.-]+$/.test(h) || h.includes('*'))) throw new Error('Use exact callback hostnames');
  return {
    readToken, ingressSecret, sendToken, chats, sendChats, sending,
    botToken: env.TELEGRAM_BOT_TOKEN,
    callbackHosts: hosts,
    port: z.coerce.number().int().min(1).max(65535).parse(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? './data/connector.sqlite',
    retentionDays: z.coerce.number().int().min(1).max(90).parse(env.RETENTION_DAYS ?? 7),
    maxMessages: 50_000, maxJobs: 10_000, maxSubscriptions: 100,
  };
}
export type Config = ReturnType<typeof loadConfig>;
