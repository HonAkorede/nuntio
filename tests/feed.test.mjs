import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../server/db.js';
import { createRpc } from '../server/rpc.js';
import { acquireLock, parseLaunch, releaseLock, runIndexer } from '../server/feed/indexer.js';

const config = JSON.parse(readFileSync(new URL('../src/data/launch-sources.json', import.meta.url), 'utf8'));
const [v2, v3, v4] = config.sources;
const pad = (hex, size = 64) => hex.replace(/^0x/, '').padStart(size, '0');
const addrTopic = (address) => `0x${pad(address)}`;
const TOKEN_A = '0x' + 'a'.repeat(40);
const TOKEN_B = '0x' + 'b'.repeat(40);
const POOL = '0x' + 'c'.repeat(40);
const HOOK = '0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec';
const tx = (n) => `0x${pad(n.toString(16))}`;

async function memoryDb() {
  const pg = new PGlite();
  const db = { query: async (text, params = []) => (await pg.query(text, params)).rows };
  await migrate(db);
  return db;
}

function v2Log(n, block) {
  return { address: v2.address, topics: [v2.topic, addrTopic(TOKEN_A), addrTopic(TOKEN_B)], data: `0x${pad(POOL)}${pad('1')}`, blockNumber: `0x${block.toString(16)}`, transactionHash: tx(n), logIndex: '0x0' };
}
function v3Log(n, block) {
  return { address: v3.address, topics: [v3.topic, addrTopic(TOKEN_A), addrTopic(TOKEN_B), `0x${pad('bb8')}`], data: `0x${pad('3c')}${pad(POOL)}`, blockNumber: `0x${block.toString(16)}`, transactionHash: tx(n), logIndex: '0x1' };
}
function v4Log(n, block) {
  const id = `0x${pad(n.toString(16)).replace(/^0/, 'f')}`;
  return { address: v4.address, topics: [v4.topic, id, addrTopic('0x0'), addrTopic(TOKEN_A)], data: `0x${pad('2710')}${pad('c8')}${pad(HOOK)}${pad('1'.repeat(30))}${pad('ffff')}`, blockNumber: `0x${block.toString(16)}`, transactionHash: tx(n), logIndex: '0x2' };
}


/** Answer an aggregate3 call like Multicall3 would: every token is named after its address. */
function multicallAnswer(data) {
  const body = data.slice(10);
  const count = parseInt(body.slice(64, 128), 16);
  const word = (v) => BigInt(v).toString(16).padStart(64, '0');
  const str = (text) => { const hex = Buffer.from(text).toString('hex'); return word(32) + word(hex.length / 2) + hex.padEnd(64, '0'); };
  const items = [];
  for (let i = 0; i < count; i++) {
    const offset = parseInt(body.slice(128 + i * 64, 192 + i * 64), 16) * 2 + 128;
    const target = '0x' + body.slice(offset + 24, offset + 64);
    const selOffset = offset + 64 * 4;
    const selector = body.slice(selOffset, selOffset + 8);
    const result = { '06fdde03': str('Token ' + target.slice(2, 6)), '95d89b41': str('T' + target.slice(2, 5).toUpperCase()), '313ce567': word(18), '18160ddd': word(10n ** 27n) }[selector];
    items.push(word(1) + word(64) + word(result.length / 2) + result);
  }
  let at = count * 32;
  const offsets = items.map((item) => { const o = word(at); at += item.length / 2; return o; });
  return '0x' + word(32) + word(count) + offsets.join('') + items.join('');
}

/** A fake Elysium RPC: logs by source, a cap on logs per call, and batch support. */
function fakeChain({ head = 1000, logs = {}, cap = 10000 } = {}) {
  const seen = [];
  const answer = (request) => {
    seen.push(request.method);
    if (request.method === 'eth_blockNumber') return `0x${head.toString(16)}`;
    if (request.method === 'eth_getLogs') {
      const { fromBlock, toBlock, address } = request.params[0];
      const found = (logs[address] || []).filter((log) => parseInt(log.blockNumber, 16) >= parseInt(fromBlock, 16) && parseInt(log.blockNumber, 16) <= parseInt(toBlock, 16));
      if (found.length > cap) return { error: { code: -32005, message: `logs count limit exceeded (${cap}) consider refine/narrow down your query` } };
      return found;
    }
    if (request.method === 'eth_getBlockByNumber') return { timestamp: `0x${(1794400000 + parseInt(request.params[0], 16)).toString(16)}` };
    if (request.method === 'eth_getTransactionByHash') return { from: '0x' + 'd'.repeat(40) };
    if (request.method === 'eth_call') return multicallAnswer(request.params[0].data);
    return { error: { code: -32601, message: 'no' } };
  };
  const reply = (request) => { const result = answer(request); return result && result.error ? { jsonrpc: '2.0', id: request.id, error: result.error } : { jsonrpc: '2.0', id: request.id, result }; };
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)), { status: 200 });
  };
  return { fetcher, seen };
}

test('launch sources are the officially published Uniswap contracts, lowercase and complete', () => {
  assert.equal(config.chain, 'elysium');
  assert.deepEqual(config.sources.map(({ id }) => id), ['uniswap-v2', 'uniswap-v3', 'uniswap-v4']);
  for (const source of config.sources) {
    assert.match(source.address, /^0x[0-9a-f]{40}$/);
    assert.match(source.topic, /^0x[0-9a-f]{64}$/);
    assert.match(source.docs, /^https:\/\/developers\.uniswap\.org\//);
  }
});

test('each Uniswap event shape parses into a launch', () => {
  assert.deepEqual(parseLaunch(v2, v2Log(1, 10)), { source: 'uniswap-v2', pool: POOL, token0: TOKEN_A, token1: TOKEN_B, hook: null, fee: null, blockNumber: 10, txHash: tx(1), logIndex: 0 });
  const three = parseLaunch(v3, v3Log(2, 11));
  assert.equal(three.fee, 3000);
  assert.equal(three.pool, POOL);
  const four = parseLaunch(v4, v4Log(3, 12));
  assert.equal(four.token0, '0x' + '0'.repeat(40), 'native HYPE is currency 0x0 in v4');
  assert.equal(four.token1, TOKEN_A);
  assert.equal(four.hook, HOOK);
  assert.equal(four.fee, 10000);
  assert.match(four.pool, /^0x[0-9a-f]{64}$/);
});

test('unexpected or tampered logs are rejected, never guessed', () => {
  const good = v3Log(4, 13);
  for (const bad of [
    null,
    { ...good, removed: true },
    { ...good, address: '0x' + '1'.repeat(40) },
    { ...good, topics: ['0x' + '9'.repeat(64), ...good.topics.slice(1)] },
    { ...good, topics: [good.topics[0], `0x${'f'.repeat(64)}`, good.topics[2], good.topics[3]] },
    { ...good, data: '0xzz' },
    { ...good, data: `0x${pad('3c')}${'f'.repeat(64)}` },
    { ...good, transactionHash: 'nope' },
  ]) assert.equal(parseLaunch(v3, bad), null);
});

test('first run reads recent blocks from every source, stores launches with time and deployer', async () => {
  const db = await memoryDb();
  const chain = fakeChain({ head: 1000, logs: { [v2.address]: [v2Log(1, 900)], [v3.address]: [v3Log(2, 950)], [v4.address]: [v4Log(3, 990), v4Log(4, 999)] } });
  const result = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: chain.fetcher }), sources: config.sources, confirmations: 5, firstRunLookback: 200 });
  assert.equal(result.stopped, null);
  assert.equal(result.safeBlock, 995);
  assert.deepEqual(Object.values(result.sources).map(({ inserted }) => inserted), [1, 1, 1], 'block 999 is not yet past the confirmation window');
  const rows = await db.query('SELECT source, deployer, block_time FROM launches ORDER BY block_number');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.deployer === '0x' + 'd'.repeat(40) && row.block_time));
  const usage = await db.query('SELECT calls FROM rpc_usage');
  assert.equal(usage[0].calls, result.calls);

  // The next run continues from the saved position and does not store duplicates.
  const again = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: fakeChain({ head: 1010, logs: { [v4.address]: [v4Log(3, 990), v4Log(4, 999)] } }).fetcher }), sources: config.sources, confirmations: 5 });
  assert.equal(again.sources['uniswap-v4'].from, 996);
  assert.equal(again.sources['uniswap-v4'].inserted, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM launches'))[0].n, 4);
});

test('a range with too many events is split in half until it fits', async () => {
  const db = await memoryDb();
  const many = Array.from({ length: 30 }, (_, index) => v4Log(100 + index, 500 + index));
  const chain = fakeChain({ head: 1000, logs: { [v4.address]: many }, cap: 10 });
  const result = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: chain.fetcher, maxCalls: 200 }), sources: [v4], confirmations: 0, firstRunLookback: 600, maxRange: 1000 });
  assert.equal(result.stopped, null);
  assert.equal(result.sources['uniswap-v4'].inserted, 30);
});

test('a used up call budget stops cleanly and the next run resumes where it left off', async () => {
  const db = await memoryDb();
  const logs = { [v4.address]: Array.from({ length: 6 }, (_, index) => v4Log(200 + index, 100 + index * 150)) };
  const first = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: fakeChain({ head: 1000, logs }).fetcher, maxCalls: 4 }), sources: [v4], confirmations: 0, firstRunLookback: 1000, maxRange: 150 });
  assert.match(first.stopped, /budget/);
  const saved = Number((await db.query('SELECT last_block FROM index_cursor'))[0].last_block);
  assert.ok(saved > 0 && saved < 1000);
  const second = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: fakeChain({ head: 1000, logs }).fetcher, maxCalls: 100 }), sources: [v4], confirmations: 0, maxRange: 150 });
  assert.equal(second.stopped, null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM launches'))[0].n, 6);
});

test('only one run at a time; the lock frees itself when released', async () => {
  const db = await memoryDb();
  assert.equal(await acquireLock(db, 60), true);
  const blocked = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: fakeChain().fetcher }), sources: config.sources });
  assert.equal(blocked.skipped, 'another run is in progress');
  await releaseLock(db);
  assert.equal(await acquireLock(db, 60), true);
});

test('launches older than the retention window are removed', async () => {
  const db = await memoryDb();
  await db.query(`INSERT INTO launches (source, pool, token0, token1, block_number, block_time, tx_hash, log_index) VALUES
    ('uniswap-v3', 'p', 'a', 'b', 1, now() - interval '20 days', '0x1', 0), ('uniswap-v3', 'p', 'a', 'b', 2, now(), '0x2', 0)`);
  await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: fakeChain({ head: 10 }).fetcher }), sources: [v3], confirmations: 0, firstRunLookback: 5 });
  assert.deepEqual((await db.query('SELECT tx_hash FROM launches')).map((row) => row.tx_hash), ['0x2']);
});

test('RPC client rejects malformed replies and enforces its budget', async () => {
  const rpc = createRpc('https://rpc.test', { fetcher: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: '0x1' })), maxCalls: 1 });
  await assert.rejects(rpc.call('eth_blockNumber', []), /Malformed/);
  await assert.rejects(rpc.call('eth_blockNumber', []), /budget/);
});

test('rate limited items inside a batch are retried once, and still missing fields stay empty', async () => {
  const db = await memoryDb();
  const chain = fakeChain({ head: 1000, logs: { [v4.address]: [v4Log(300, 990), v4Log(301, 991)] } });
  let batches = 0;
  const flaky = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!Array.isArray(body)) return chain.fetcher(url, init);
    batches++;
    // First batch: every item rate limited. Retry: all succeed except one transaction lookup.
    if (batches === 1) return new Response(JSON.stringify(body.map((item) => ({ jsonrpc: '2.0', id: item.id, error: { code: -32017, message: 'Rate Limit Exceeded' } }))));
    const answered = await (await chain.fetcher(url, init)).json();
    return new Response(JSON.stringify(answered.map((item, index) => (body[index].params[0] === tx(301) ? { jsonrpc: '2.0', id: item.id, error: { code: -32017, message: 'Rate Limit Exceeded' } } : item))));
  };
  await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: flaky }), sources: [v4], confirmations: 0, firstRunLookback: 20 });
  const rows = await db.query('SELECT tx_hash, deployer, block_time FROM launches ORDER BY tx_hash');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.block_time), 'block times recovered on retry');
  assert.equal(rows.find((row) => row.tx_hash === tx(300)).deployer, '0x' + 'd'.repeat(40));
  assert.equal(rows.find((row) => row.tx_hash === tx(301)).deployer, null, 'never guessed');
});

test('new tokens get their name and symbol read in one batched request, cleaned as plain text', async () => {
  const db = await memoryDb();
  const chain = fakeChain({ head: 1000, logs: { [v4.address]: [v4Log(400, 990)] } });
  const result = await runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: chain.fetcher }), sources: [v4], baseTokens: config.baseTokens.addresses, confirmations: 0, firstRunLookback: 20 });
  assert.equal(result.tokensRead, 1, 'native HYPE (0x0) is not read as a token');
  assert.equal(chain.seen.filter((method) => method === 'eth_call').length, 1);
  const [token] = await db.query('SELECT * FROM tokens');
  assert.deepEqual([token.address, token.name, token.symbol, token.decimals, token.total_supply], [TOKEN_A, 'Token aaaa', 'TAAA', 18, (10n ** 27n).toString()]);
});

// Routes: the scheduled update, the feed and the refresh, through the real Hono app.
const { createApp } = await import('../server/app.js');
const { feeLabel, createLimiter } = await import('../server/feed/routes.js');
const SECRET = 'x'.repeat(24);

async function feedApp(logs = { [v4.address]: [v4Log(500, 990)] }, overrides = {}) {
  const db = await memoryDb();
  const chain = fakeChain({ head: 1000, logs });
  const app = createApp({ feed: { getDb: () => db, cronSecret: SECRET, rpcUrl: 'https://rpc.test', sources: config.sources, baseTokens: config.baseTokens.addresses, fetcher: chain.fetcher, retryDelayMs: 0, ...overrides } });
  return { app, db, chain };
}
const fromIp = (ip, init = {}) => ({ ...init, headers: { 'x-forwarded-for': ip, ...(init.headers || {}) } });

test('scheduled update needs the exact secret, then indexes', async () => {
  const { app } = await feedApp();
  assert.equal((await app.request('/api/cron/index')).status, 401);
  assert.equal((await app.request('/api/cron/index', { headers: { authorization: `Bearer ${'y'.repeat(24)}` } })).status, 401);
  const ok = await app.request('/api/cron/index', { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).sources['uniswap-v4'].inserted, 1);
  const { app: noSecret } = await feedApp(undefined, { cronSecret: undefined });
  assert.equal((await noSecret.request('/api/cron/index', { headers: { authorization: 'Bearer ' } })).status, 503);
});

test('feed lists launches with the new token, labels and disclaimer, without touching the chain', async () => {
  const { app, chain } = await feedApp();
  await app.request('/api/cron/index', { headers: { authorization: `Bearer ${SECRET}` } });
  const before = chain.seen.length;
  const response = await app.request('/api/launches', fromIp('1.1.1.1'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /s-maxage=30/);
  const body = await response.json();
  assert.equal(chain.seen.length, before, 'reading the feed makes no RPC requests');
  assert.match(body.disclaimer, /Not financial advice/);
  assert.ok(body.updatedAt);
  const [launch] = body.launches;
  assert.equal(launch.token, TOKEN_A);
  assert.equal(launch.symbol, 'TAAA');
  assert.equal(launch.fee, '1%');
  assert.equal(launch.hook, HOOK);
  assert.equal(launch.deployerLaunches, 1);
  assert.equal(body.next, null);
});

test('feed paging and input checks', async () => {
  const many = Array.from({ length: 5 }, (_, index) => v3Log(600 + index, 980 + index));
  const { app } = await feedApp({ [v3.address]: many });
  await app.request('/api/cron/index', { headers: { authorization: `Bearer ${SECRET}` } });
  const first = await (await app.request('/api/launches?limit=2', fromIp('2.2.2.2'))).json();
  assert.equal(first.launches.length, 2);
  const second = await (await app.request(`/api/launches?limit=2&before=${first.next}`, fromIp('2.2.2.2'))).json();
  assert.ok(Number(second.launches[0].id) < Number(first.launches[1].id) + 1);
  const odd = await app.request("/api/launches?limit=9999&before=1;DROP TABLE launches", fromIp('2.2.2.2'));
  assert.equal(odd.status, 200);
  assert.equal((await odd.json()).launches.length, 5);
});

test('refresh is limited to one a minute per visitor and skips when the feed is fresh', async () => {
  const { app, chain } = await feedApp();
  const first = await app.request('/api/launches/refresh', fromIp('3.3.3.3', { method: 'POST' }));
  assert.equal((await first.json()).status, 'updated');
  assert.equal((await app.request('/api/launches/refresh', fromIp('3.3.3.3', { method: 'POST' }))).status, 429);
  const calls = chain.seen.length;
  const other = await app.request('/api/launches/refresh', fromIp('4.4.4.4', { method: 'POST' }));
  assert.equal((await other.json()).status, 'fresh');
  assert.equal(chain.seen.length, calls, 'a fresh feed makes no RPC requests');
});

test('feed routes answer 503 when no database is set, and the API never exposes write or trade routes', async () => {
  const app = createApp({ feed: { getDb: () => null, cronSecret: SECRET, rpcUrl: 'https://rpc.test', sources: config.sources, baseTokens: [] } });
  assert.equal((await app.request('/api/launches', fromIp('5.5.5.5'))).status, 503);
  assert.equal((await app.request('/api/launches', { method: 'DELETE' })).status, 404);
  assert.equal((await app.request('/api/swap', { method: 'POST' })).status, 404);
});

test('fee labels and the per visitor limiter', () => {
  assert.equal(feeLabel('uniswap-v2', null), '0.3%');
  assert.equal(feeLabel('uniswap-v3', 500), '0.05%');
  assert.equal(feeLabel('uniswap-v4', 0x800000), 'dynamic');
  assert.equal(feeLabel('uniswap-v4', 10000), '1%');
  let time = 0;
  const limit = createLimiter(2, 1000, () => time);
  assert.deepEqual([limit('a'), limit('a'), limit('a'), limit('b')], [true, true, false, true]);
  time = 1001;
  assert.equal(limit('a'), true);
});

test('a busy window never gets stuck: with a tight budget, launches are still stored and the reader moves forward', async () => {
  const db = await memoryDb();
  const logs = { [v4.address]: Array.from({ length: 120 }, (_, index) => v4Log(700 + index, 100 + index)) };
  const run = () => runIndexer({ retryDelayMs: 0, db, rpc: createRpc('https://rpc.test', { fetcher: fakeChain({ head: 1000, logs }).fetcher, maxCalls: 8 }), sources: [v4], confirmations: 0, firstRunLookback: 1000, maxRange: 1000 });
  await run();
  const stored = (await db.query('SELECT count(*)::int AS n, count(deployer)::int AS with_deployer FROM launches'))[0];
  assert.equal(stored.n, 120, 'every launch is stored even when lookups run out of budget');
  assert.ok(stored.with_deployer < 120, 'some lookups were skipped to stay inside the budget');
  assert.equal(Number((await db.query('SELECT last_block FROM index_cursor'))[0].last_block), 1000);
});
