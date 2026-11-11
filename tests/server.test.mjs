import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { VERSION } from '../server/version.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { ConfigError, SETTINGS, loadEnv } from '../server/env.js';
import { findSecrets } from '../scripts/check-secrets.mjs';

const dist = mkdtempSync(join(tmpdir(), 'nuntio-dist-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>home</title>');
writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
const app = createApp({ distDir: dist, version: '9.9.9' });

test('health endpoint answers with status and version, uncached', async () => {
  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'nuntio', version: '9.9.9' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('unknown API routes return JSON 404, and no write routes exist', async () => {
  for (const [method, path] of [['GET', '/api/nope'], ['POST', '/api/health'], ['POST', '/api/trade']]) {
    const response = await app.request(path, { method });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  }
});

test('the static site is served from dist, including folder index pages', async () => {
  const home = await app.request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>home<\/title>/);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const asset = await app.request('/assets/app.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=300');
  assert.equal((await app.request('/missing.html')).status, 404);
  assert.equal((await app.request('/../package.json')).status, 404);
});

test('the Vercel function answers /api routes and leaves static files to the CDN', async () => {
  const api = await import('../api/index.js');
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(typeof api[method], 'function', method);
  const health = await api.GET(new Request('https://example.test/api/health'));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).version, VERSION);
  assert.equal((await api.POST(new Request('https://example.test/api/trade', { method: 'POST' }))).status, 404);
  assert.equal((await api.GET(new Request('https://example.test/'))).status, 404, 'On Vercel, / is served from public/ by the CDN');
});

test('vercel.json sends /api to the function and serves the built site from public', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.framework, null);
  assert.equal(vercel.outputDirectory, 'public');
  assert.deepEqual(vercel.rewrites, [{ source: '/api/(.*)', destination: '/api' }]);
});

test('server version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('vercel.json builds with the Vercel script, which copies dist to public', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(vercel.buildCommand, 'npm run build:vercel');
  assert.match(pkg.scripts['build:vercel'], /npm run build && node scripts\/copy-to-public\.mjs/);
});

test('settings load with safe defaults and reject bad values without echoing them', () => {
  const config = loadEnv({});
  assert.equal(config.port, 3000);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.databaseUrl, undefined);
  assert.throws(() => loadEnv({ PORT: 'abc' }), ConfigError);
  assert.throws(() => loadEnv({ NODE_ENV: 'staging' }), ConfigError);
});

test('the settings summary never prints a secret value', () => {
  const secret = 'postgres://user:hunter2@db.example/nuntio';
  const summary = loadEnv({ DATABASE_URL: secret, PORT: '4000' }).summary();
  assert.ok(!summary.includes('hunter2'));
  assert.match(summary, /DATABASE_URL=\(set, hidden\)/);
  assert.match(summary, /PORT=4000/);
});

test('every setting is documented in .env.example', async () => {
  const { readFileSync } = await import('node:fs');
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  for (const { name } of SETTINGS) assert.match(example, new RegExp(`^#? ?${name}=`, 'm'), name);
});

test('secret check flags likely keys and allows ordinary text', () => {
  const fakeKey = ['sk', 'ant', 'api03', 'A'.repeat(40)].join('-');
  assert.equal(findSecrets('notes.txt', `token = ${fakeKey}`).length, 1);
  assert.equal(findSecrets('a.js', `const k = "${'AKIA'}${'ABCDEFGHIJKLMNOP'}";`).length, 1);
  assert.equal(findSecrets('a.js', `-----BEGIN ${'PRIVATE'} KEY-----`).length, 1);
  assert.equal(findSecrets('.env', 'PORT=3000').length, 1, 'A real .env file must never be committed');
  assert.equal(findSecrets('.env.example', 'PORT=3000').length, 0);
  assert.equal(findSecrets('README.md', 'Never paste a private key or seed phrase.').length, 0);
});
