import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { safePost } from '../src/security.js';

// Exercise real safePost logic with DNS/socket boundaries replaced, never TLS
// verification disabled or a private-network bypass in production config.
test('callback DNS is pinned to the validated address and redirect is returned without a second request', async () => {
  let calls = 0; let options: RequestOptions | undefined;
  const fakeRequest = (_url: URL, opts: RequestOptions, cb: (r: IncomingMessage) => void) => {
    calls++; options = opts;
    const req = new EventEmitter() as ClientRequest;
    req.end = (() => {
      const res = new PassThrough() as unknown as IncomingMessage;
      res.statusCode = 302; res.headers = { location: 'https://127.0.0.1/secret' };
      cb(res); queueMicrotask(() => (res as unknown as PassThrough).end('{}'));
      return req;
    }) as ClientRequest['end'];
    return req;
  };
  const post = safePost(['receiver.example.com'], {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: fakeRequest as typeof request,
  });
  const res = await post('https://receiver.example.com/event', '{}', {});
  assert.equal(res.status, 302); assert.equal(calls, 1);
  assert.equal(options!.servername, 'receiver.example.com');
  assert.equal(options!.family, 4); assert.equal(options!.agent, false);
  const pinned = options!.lookup as (host: string, options: object, callback: (err: Error | null, ip: string, family: number) => void) => void;
  pinned('receiver.example.com', {}, (error, ip, family) => {
    assert.equal(error, null); assert.equal(ip, '8.8.8.8'); assert.equal(family, 4);
  });
});
test('mixed public/private DNS answers are rejected before socket creation', async () => {
  let calls = 0;
  const post = safePost(['receiver.example.com'], {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
    request: (() => { calls++; throw new Error('must not connect'); }) as typeof request,
  });
  await assert.rejects(post('https://receiver.example.com/event', '{}', {}), /non_public_callback/);
  assert.equal(calls, 0);
});
