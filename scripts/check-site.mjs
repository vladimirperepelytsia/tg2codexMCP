import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve('site');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML ids');
assert.equal((html.match(/<h1\b/g) ?? []).length, 1, 'Exactly one primary heading');
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="#main"/);
assert.doesNotMatch(html, /<(script|iframe)\b/i, 'Static site must not load executable embeds');
for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  if (value.startsWith('#')) {
    assert(ids.includes(value.slice(1)), `Missing anchor: ${value}`);
  } else if (value.startsWith('https://')) {
    const url = new URL(value);
    assert(['github.com', 'vladimirperepelytsia.github.io'].includes(url.hostname), `Unexpected external origin: ${value}`);
    if (url.hostname === 'github.com') {
      assert(url.pathname.startsWith('/vladimirperepelytsia/tg2codexMCP'), `Unexpected repository: ${value}`);
      const file = url.pathname.match(/\/(?:blob|tree)\/main\/(.+)/)?.[1];
      if (file) await stat(resolve(file));
    }
  } else {
    assert(value.startsWith('./'), `Project-path unsafe asset: ${value}`);
    const target = resolve(root, value);
    assert(target === root || target.startsWith(root + sep), 'Asset escaped site directory');
    await stat(target);
  }
}
let bytes = 0;
for (const name of await readdir(root)) {
  assert(['index.html', 'styles.css', 'icon.svg', '.nojekyll'].includes(name), `Unexpected publish artifact: ${name}`);
  bytes += (await stat(resolve(root, name))).size;
}
assert(bytes < 100_000, 'Static page exceeded 100 KB budget');
// Explanatory placeholders intentionally fail numeric validation until configured.
for (const file of ['.env.example', 'examples/http.env.example', 'examples/offline.env.example']) {
  const env = await readFile(resolve(file), 'utf8');
  assert.match(env, /^ALLOWED_CHAT_IDS=<tg_channel_id>$/m);
  assert.doesNotMatch(env, /^ALLOWED_CHAT_IDS=-?\d/m);
}
console.log(`Site checks passed: local assets, fragments, repository links, safe artifact allowlist; ${bytes} bytes.`);
