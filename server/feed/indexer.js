import { RpcError } from '../rpc.js';
import { readTokens } from './multicall.js';

/** Reads pool creation events from the official Uniswap contracts on Elysium and stores them.
 * Research only: this reads public chain data and never signs or sends anything.
 * All chain data is untrusted: every field is checked before it is stored. */

const HEX = /^0x[0-9a-f]+$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const TOPIC_ADDRESS = /^0x0{24}[0-9a-f]{40}$/i;
const WORD_ADDRESS = /^0{24}[0-9a-f]{40}$/i;

/** @param {unknown} topic */
function topicAddress(topic) {
  return typeof topic === 'string' && TOPIC_ADDRESS.test(topic) ? `0x${topic.slice(26).toLowerCase()}` : null;
}
/** @param {string} data @param {number} index */
function word(data, index) { return data.slice(2 + 64 * index, 2 + 64 * (index + 1)); }
/** @param {string} data @param {number} index */
function wordAddress(data, index) { const value = word(data, index); return WORD_ADDRESS.test(value) ? `0x${value.slice(24).toLowerCase()}` : null; }
/** @param {string} data @param {number} index */
function wordSmallInt(data, index) { const value = word(data, index); return /^[0-9a-f]{64}$/i.test(value) && /^0{56}/.test(value) ? parseInt(value, 16) : null; }

/** @typedef {{ id: string, address: string, topic: string }} Source */
/** @typedef {{ source: string, pool: string, token0: string, token1: string, hook: string | null, fee: number | null, blockNumber: number, txHash: string, logIndex: number }} Launch */

/** Turn one log into a launch, or null when anything about it is unexpected.
 * @param {Source} source @param {any} log @returns {Launch | null} */
export function parseLaunch(source, log) {
  if (!log || typeof log !== 'object' || log.removed === true) return null;
  if (String(log.address).toLowerCase() !== source.address || !Array.isArray(log.topics) || String(log.topics[0]).toLowerCase() !== source.topic) return null;
  if (typeof log.data !== 'string' || !/^0x([0-9a-f]{64})*$/i.test(log.data)) return null;
  if (!HASH.test(log.transactionHash) || !HEX.test(log.blockNumber) || !HEX.test(log.logIndex)) return null;
  const base = { source: source.id, blockNumber: parseInt(log.blockNumber, 16), txHash: log.transactionHash.toLowerCase(), logIndex: parseInt(log.logIndex, 16) };
  const token0 = topicAddress(log.topics[source.id === 'uniswap-v4' ? 2 : 1]);
  const token1 = topicAddress(log.topics[source.id === 'uniswap-v4' ? 3 : 2]);
  if (!token0 || !token1) return null;
  if (source.id === 'uniswap-v2') {
    const pool = log.data.length >= 2 + 64 * 2 ? wordAddress(log.data, 0) : null;
    return pool ? { ...base, pool, token0, token1, hook: null, fee: null } : null;
  }
  if (source.id === 'uniswap-v3') {
    const fee = typeof log.topics[3] === 'string' && /^0x0{58}[0-9a-f]{6}$/i.test(log.topics[3]) ? parseInt(log.topics[3], 16) : null;
    const pool = log.data.length >= 2 + 64 * 2 ? wordAddress(log.data, 1) : null;
    return pool && fee !== null ? { ...base, pool, token0, token1, hook: null, fee } : null;
  }
  if (source.id === 'uniswap-v4') {
    const pool = typeof log.topics[1] === 'string' && HASH.test(log.topics[1]) ? log.topics[1].toLowerCase() : null;
    const fee = log.data.length >= 2 + 64 * 5 ? wordSmallInt(log.data, 0) : null;
    const hook = log.data.length >= 2 + 64 * 5 ? wordAddress(log.data, 2) : null;
    return pool && fee !== null && hook ? { ...base, pool, token0, token1, hook, fee } : null;
  }
  return null;
}

/** @param {unknown} value */
const hexNumber = (value) => { if (typeof value !== 'string' || !HEX.test(value)) throw new RpcError('Malformed number'); return parseInt(value, 16); };
const isRangeError = (/** @type {unknown} */ error) => error instanceof RpcError && /limit exceeded|too many|range|narrow/i.test(error.message);

/** Block times and deployers (the wallet that sent the creating transaction), read in batches.
 * Failures leave the field empty rather than guessing.
 * @param {ReturnType<typeof import('../rpc.js').createRpc>} rpc @param {Launch[]} launches */
async function enrich(rpc, launches, { batchSize = 10, retryDelayMs = 1000, reserve = 4 } = {}) {
  const blocks = [...new Set(launches.map((launch) => launch.blockNumber))];
  const txs = [...new Set(launches.map((launch) => launch.txHash))];
  /** @type {Map<number, Date>} */ const times = new Map();
  /** @type {Map<string, string>} */ const senders = new Map();
  const requests = /** @type {[string, unknown[], (result: any) => void][]} */ ([
    ...blocks.map((block) => /** @type {[string, unknown[], (result: any) => void]} */ (['eth_getBlockByNumber', [`0x${block.toString(16)}`, false], (result) => { if (result && HEX.test(result.timestamp)) times.set(block, new Date(parseInt(result.timestamp, 16) * 1000)); }])),
    ...txs.map((hash) => /** @type {[string, unknown[], (result: any) => void]} */ (['eth_getTransactionByHash', [hash], (result) => { const from = String(result?.from || '').toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(from)) senders.set(hash, from); }])),
  ]);
  // The public RPC rate limits single items inside a batch, so keep batches small and retry failed items once.
  // Lookups are best effort: when the run's budget gets low they stop, and the launches are still stored
  // with these fields empty, so the reader always moves forward instead of redoing the same blocks.
  let pending = requests;
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    /** @type {typeof requests} */
    const failed = [];
    for (let index = 0; index < pending.length; index += batchSize) {
      if (rpc.remaining <= reserve) return finish();
      const chunk = pending.slice(index, index + batchSize);
      const results = await rpc.batch(chunk.map(([method, params]) => [method, params]));
      results.forEach((result, position) => { if (result instanceof Error) failed.push(chunk[position]); else chunk[position][2](result); });
    }
    pending = failed;
  }
  return finish();
  function finish() { return launches.map((launch) => ({ ...launch, blockTime: times.get(launch.blockNumber) || null, deployer: senders.get(launch.txHash) || null })); }
}

/** @param {import('../db.js').Db} db @param {(Launch & { blockTime: Date | null, deployer: string | null })[]} rows */
async function store(db, rows) {
  if (!rows.length) return 0;
  const columns = ['source', 'pool', 'token0', 'token1', 'hook', 'fee', 'block_number', 'block_time', 'tx_hash', 'log_index', 'deployer'];
  /** @type {unknown[]} */ const params = [];
  const values = rows.map((row) => {
    params.push(row.source, row.pool, row.token0, row.token1, row.hook, row.fee, row.blockNumber, row.blockTime ? row.blockTime.toISOString() : null, row.txHash, row.logIndex, row.deployer);
    const start = params.length - columns.length;
    return `(${columns.map((_, index) => `$${start + index + 1}`).join(', ')})`;
  });
  const inserted = await db.query(`INSERT INTO launches (${columns.join(', ')}) VALUES ${values.join(', ')} ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id`, params);
  return inserted.length;
}

/** The new token in a pool is the side that is not a pairing token (HYPE, WHYPE, USDC). */
export const NEW_TOKEN_SQL = 'CASE WHEN l.token0 = ANY($1::text[]) THEN l.token1 ELSE l.token0 END';

/** Read name, symbol, decimals and supply for the newest tokens not read yet, 50 per request.
 * @param {import('../db.js').Db} db @param {ReturnType<typeof import('../rpc.js').createRpc>} rpc @param {string[]} baseTokens @param {number} limit */
async function readNewTokens(db, rpc, baseTokens, limit) {
  const missing = await db.query(`SELECT n.address FROM (
      SELECT ${NEW_TOKEN_SQL} AS address, max(l.block_number) AS newest FROM launches l GROUP BY 1
    ) n LEFT JOIN tokens t ON t.address = n.address
    WHERE t.address IS NULL AND n.address <> '0x0000000000000000000000000000000000000000'
    ORDER BY n.newest DESC LIMIT $2`, [baseTokens, limit]);
  let count = 0;
  for (let index = 0; index < missing.length; index += 50) {
    const facts = await readTokens(rpc, missing.slice(index, index + 50).map((row) => String(row.address)));
    /** @type {unknown[]} */ const params = [];
    const values = facts.map((fact) => { params.push(fact.address, fact.name, fact.symbol, fact.decimals, fact.totalSupply); const at = params.length - 5; return `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5})`; });
    await db.query(`INSERT INTO tokens (address, name, symbol, decimals, total_supply) VALUES ${values.join(', ')} ON CONFLICT (address) DO NOTHING`, params);
    count += facts.length;
  }
  return count;
}

/** Only one run at a time. The lock expires on its own if a run dies.
 * @param {import('../db.js').Db} db @param {number} seconds */
export async function acquireLock(db, seconds) {
  const rows = await db.query(`INSERT INTO index_lock (id, until) VALUES (1, now() + make_interval(secs => $1))
    ON CONFLICT (id) DO UPDATE SET until = EXCLUDED.until WHERE index_lock.until < now() RETURNING id`, [seconds]);
  return rows.length === 1;
}
/** @param {import('../db.js').Db} db */
export async function releaseLock(db) { await db.query('UPDATE index_lock SET until = now() WHERE id = 1'); }

/**
 * @param {{ db: import('../db.js').Db, rpc: ReturnType<typeof import('../rpc.js').createRpc>, sources: Source[],
 *   baseTokens?: string[], maxTokens?: number, confirmations?: number, maxRange?: number, firstRunLookback?: number, retentionDays?: number, purpose?: string, retryDelayMs?: number }} options
 */
export async function runIndexer({ db, rpc, sources, baseTokens = [], maxTokens = 150, confirmations = 5, maxRange = 3000, firstRunLookback = 3000, retentionDays = 14, purpose = 'index', retryDelayMs = 1000 }) {
  if (!(await acquireLock(db, 240))) return { skipped: 'another run is in progress', calls: 0 };
  /** @type {Record<string, { from: number, to: number, found: number, inserted: number, invalid: number }>} */
  const report = {};
  let stopped = null;
  try {
    const safe = hexNumber(await rpc.call('eth_blockNumber', [])) - confirmations;
    for (const source of sources) {
      const [cursor] = await db.query('SELECT last_block FROM index_cursor WHERE source = $1', [source.id]);
      let from = Math.max(0, (cursor ? Number(cursor.last_block) : safe - firstRunLookback) + 1);
      const entry = (report[source.id] = { from, to: from - 1, found: 0, inserted: 0, invalid: 0 });
      let range = maxRange;
      while (from <= safe && !stopped) {
        const to = Math.min(safe, from + range - 1);
        let logs;
        try {
          logs = await rpc.call('eth_getLogs', [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: source.address, topics: [source.topic] }]);
        } catch (error) {
          if (isRangeError(error) && range > 1) { range = Math.max(1, Math.floor(range / 2)); continue; }
          if (error instanceof RpcError) { stopped = error.message; break; }
          throw error;
        }
        if (!Array.isArray(logs)) { stopped = 'Malformed getLogs answer'; break; }
        const launches = logs.map((log) => parseLaunch(source, log));
        const valid = /** @type {Launch[]} */ (launches.filter(Boolean));
        entry.found += valid.length;
        entry.invalid += launches.length - valid.length;
        try {
          entry.inserted += await store(db, await enrich(rpc, valid, { retryDelayMs }));
        } catch (error) {
          if (error instanceof RpcError) { stopped = error.message; break; }
          throw error;
        }
        await db.query(`INSERT INTO index_cursor (source, last_block, updated_at) VALUES ($1, $2, now())
          ON CONFLICT (source) DO UPDATE SET last_block = EXCLUDED.last_block, updated_at = now()`, [source.id, to]);
        entry.to = to;
        from = to + 1;
        if (logs.length < 2000) range = Math.min(maxRange, range * 2);
      }
    }
    let tokensRead = 0;
    if (!stopped) {
      try { tokensRead = await readNewTokens(db, rpc, baseTokens, maxTokens); } catch (error) { if (error instanceof RpcError || /multicall/i.test(String(error))) stopped = String(error instanceof Error ? error.message : error); else throw error; }
    }
    await db.query(`DELETE FROM launches WHERE block_time < now() - make_interval(days => $1)`, [retentionDays]);
    await db.query('DELETE FROM tokens WHERE address NOT IN (SELECT token0 FROM launches UNION SELECT token1 FROM launches)');
    return { safeBlock: safe, sources: report, tokensRead, calls: rpc.calls, stopped };
  } finally {
    await db.query(`INSERT INTO rpc_usage (day, purpose, calls) VALUES (current_date, $1, $2)
      ON CONFLICT (day, purpose) DO UPDATE SET calls = rpc_usage.calls + EXCLUDED.calls`, [purpose, rpc.calls]);
    await releaseLock(db);
  }
}
