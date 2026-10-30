import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';

export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifyIngress(body: string, timestamp: string, nonce: string, signature: string, secret: string, now = Date.now()) {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) throw new AppError('invalid_ingress_signature', 401);
  const expected = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  if (!equal(signature, `v1=${expected}`)) throw new AppError('invalid_ingress_signature', 401);
}
export function publicAddress(address: string) {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}
export function callbackUrl(raw: string, hosts: string[]) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError('invalid_callback'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !hosts.includes(url.hostname)) throw new AppError('callback_not_allowed');
  return url;
}
export type Post = (url: string, body: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<{ status: number; body: string }>;

// A fresh DNS lookup is validated and pinned into the actual TLS connection.
// No redirects, proxy environment variables, reused sockets, or second DNS lookup.
export function safePost(hosts: string[], network: {
  lookup: (host: string, options: { all: true }) => Promise<LookupAddress[]>;
  request: typeof request;
} = { lookup, request }, limits = { timeoutMs: 10000, maxResponseBytes: 65536 }): Post {
  return async (raw, body, headers, signal) => {
    signal?.throwIfAborted();
    const url = callbackUrl(raw, hosts);
    if (Buffer.byteLength(body) > 262144) throw new AppError('payload_too_large');
    const dnsSignal = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    let abortLookup: () => void = () => {};
    const addresses = await Promise.race([
      network.lookup(url.hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        abortLookup = () => reject(new AppError('dns_cancelled_or_timeout'));
        dnsSignal.addEventListener('abort', abortLookup, { once: true });
        if (dnsSignal.aborted) abortLookup();
      }),
    ]).finally(() => dnsSignal.removeEventListener('abort', abortLookup));
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new AppError('non_public_callback');
    const address = addresses[0]!;
    return new Promise((resolve, reject) => {
      const req = network.request(url, {
        method: 'POST', agent: false, servername: url.hostname, family: address.family,
        signal: AbortSignal.any([AbortSignal.timeout(limits.timeoutMs), ...(signal ? [signal] : [])]),
        lookup: (_hostname, _options, done) => done(null, address.address, address.family),
        headers: { ...headers, 'content-length': Buffer.byteLength(body), 'content-type': 'application/json' },
      }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxResponseBytes) res.destroy(new Error('response_too_large')); else chunks.push(chunk);
        });
        res.on('error', () => reject(new AppError('callback_network_error')));
        res.on('end', () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', () => reject(new AppError('callback_network_error')));
      req.end(body);
    });
  };
}
