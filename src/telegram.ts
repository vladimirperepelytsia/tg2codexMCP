import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { AppError, safePost, type Post } from './security.js';
import { Store } from './store.js';

type Method = 'getMe' | 'getWebhookInfo' | 'getUpdates';
export type TelegramApi = (method: Method, params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export class TelegramError extends AppError {
  constructor(code: string, readonly retryAfterMs = 0, readonly fatal = false) { super(code, 502); }
}
export function telegramApi(token: string, post: Post = safePost(['api.telegram.org'], undefined, { timeoutMs: 35000, maxResponseBytes: 4 * 1024 * 1024 })): TelegramApi {
  return async (method, params, signal) => {
    const response = await post(`https://api.telegram.org/bot${token}/${method}`, JSON.stringify(params), {}, signal);
    let data: unknown;
    try { data = JSON.parse(response.body); } catch { throw new TelegramError('telegram_invalid_response'); }
    const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error_code: z.number().optional(),
      parameters: z.object({ retry_after: z.number().int().nonnegative() }).optional(),
    }).safeParse(data);
    if (!envelope.success) throw new TelegramError('telegram_invalid_response');
    const error = envelope.data.error_code ?? response.status;
    if (!envelope.data.ok || response.status !== 200) {
      const fatal = [400, 401, 403, 404, 409].includes(error);
      // Never propagate Telegram descriptions: they may contain sensitive data.
      throw new TelegramError(error === 409 ? 'telegram_polling_conflict' : `telegram_api_${error}`,
        Math.min(3600000, (envelope.data.parameters?.retry_after ?? 0) * 1000), fatal);
    }
    return envelope.data.result;
  };
}
export class TelegramPoller {
  constructor(readonly store: Store, readonly call: TelegramApi,
    readonly wait = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal })) {}
  async prepare(signal: AbortSignal) {
    const me = z.object({ id: z.number().int().safe(), is_bot: z.literal(true) }).parse(await this.call('getMe', {}, signal));
    try { this.store.bindBot(String(me.id)); }
    catch (e) {
      if (e instanceof AppError && e.code === 'database_bound_to_different_bot') throw new TelegramError(e.code, 0, true);
      throw e;
    }
    const info = z.object({ url: z.string() }).parse(await this.call('getWebhookInfo', {}, signal));
    if (info.url) throw new TelegramError('telegram_webhook_already_configured', 0, true);
  }
  async pollOnce(signal: AbortSignal) {
    const offset = this.store.pollOffset();
    const result = await this.call('getUpdates', {
      ...(offset === undefined ? {} : { offset }), limit: 100, timeout: 25,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    }, signal);
    // Check IDs and ordering for the entire batch before advancing the cursor.
    const batch = z.array(z.object({ update_id: z.number().int().safe().nonnegative() }).passthrough()).max(100).parse(result);
    if (batch.some((u, i) => (i > 0 && u.update_id <= batch[i - 1]!.update_id) || (offset !== undefined && u.update_id < offset))) {
      throw new TelegramError('telegram_invalid_update_order');
    }
    for (const update of batch) { signal.throwIfAborted(); this.store.ingestPolled(update); }
  }
  async run(signal: AbortSignal, report: (code: string) => void) {
    let ready = false, failures = 0;
    while (!signal.aborted) {
      try {
        if (!ready) { await this.prepare(signal); ready = true; }
        await this.pollOnce(signal); failures = 0;
        // Prevent a tight loop if the upstream returns early with an empty batch.
        await this.wait(100, signal);
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof TelegramError && e.fatal) throw e;
        report(e instanceof AppError ? e.code : 'telegram_polling_retry');
        const delay = Math.max(e instanceof TelegramError ? e.retryAfterMs : 0, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
        try { await this.wait(delay, signal); } catch { if (signal.aborted) return; throw new AppError('polling_wait_failed'); }
      }
    }
  }
}
