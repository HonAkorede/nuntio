import { timingSafeEqual } from 'node:crypto';
import { migrate } from '../db.js';
import { createRpc } from '../rpc.js';
import { NEW_TOKEN_SQL, runIndexer } from './indexer.js';

/** Elysium launch feed routes. Research only: they read public chain data and never sign or send anything.
 *
 * Request costs (see README):
 * - GET /api/cron/index (Vercel Schedule, every 15 minutes): at most 60 RPC requests and a few database queries.
 * - GET /api/launches: 2 database queries, no RPC. Cached at the CDN for 30 seconds.
 * - POST /api/launches/refresh: no RPC when the feed is under 3 minutes old; otherwise at most 15 RPC requests.
 */

export const DISCLAIMER = 'New tokens are very high risk. A listing here is not an endorsement, and a clean result does not mean safe. Not financial advice.';
const DYNAMIC_FEE = 0x800000;

/** Fee in hundredths of a basis point (Uniswap units) as a percent label. v2 is always 0.3%.
 * @param {string} source @param {number | null} fee */
export function feeLabel(source, fee) {
  if (source === 'uniswap-v2') return '0.3%';
  if (fee === null || fee === undefined) return 'unknown';
  if (source === 'uniswap-v4' && (fee & DYNAMIC_FEE) !== 0) return 'dynamic';
  return `${Number((fee / 10000).toFixed(4))}%`;
}

/** Best effort per visitor limits. Each server instance keeps its own counts.
 * @param {number} limit @param {number} windowMs */
export function createLimiter(limit, windowMs, now = () => Date.now()) {
  /** @type {Map<string, { count: number, reset: number }>} */
  const hits = new Map();
  return (/** @type {string} */ key) => {
    const time = now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= time) hits.delete(k);
    const entry = hits.get(key);
    if (!entry || entry.reset <= time) { hits.set(key, { count: 1, reset: time + windowMs }); return true; }
    entry.count++;
    return entry.count <= limit;
  };
}

/** @param {import('hono').Context} c */
const visitor = (c) => (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown';

/** @param {string | undefined} given @param {string} expected */
function sameSecret(given, expected) {
  const a = Buffer.from(given || '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {import('hono').Hono} app
 * @param {{ getDb: () => import('../db.js').Db | null, cronSecret?: string, rpcUrl: string, sources: any[], baseTokens: string[], fetcher?: typeof fetch, retryDelayMs?: number }} feed
 */
export function registerFeedRoutes(app, feed) {
  const listLimit = createLimiter(60, 60_000);
  const refreshLimit = createLimiter(1, 60_000);
  let migrated = false;
  async function database() {
    const db = feed.getDb();
    if (db && !migrated) { await migrate(db); migrated = true; }
    return db;
  }
  /** @param {import('../db.js').Db} db @param {string} purpose @param {number} maxCalls */
  const run = (db, purpose, maxCalls) => runIndexer({
    db, purpose, sources: feed.sources, baseTokens: feed.baseTokens, retryDelayMs: feed.retryDelayMs,
    rpc: createRpc(feed.rpcUrl, { maxCalls, fetcher: feed.fetcher }),
  });

  app.get('/api/cron/index', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!feed.cronSecret || feed.cronSecret.length < 16) return c.json({ error: 'Scheduled updates are not configured' }, 503);
    if (!sameSecret(c.req.header('authorization'), `Bearer ${feed.cronSecret}`)) return c.json({ error: 'Unauthorized' }, 401);
    const db = await database();
    if (!db) return c.json({ error: 'Feed not configured' }, 503);
    const result = await run(db, 'schedule', 60);
    console.log(`Index run: ${JSON.stringify({ calls: result.calls, stopped: result.stopped ?? null, skipped: result.skipped ?? null })}`);
    return c.json(result);
  });

  app.get('/api/launches', async (c) => {
    if (!listLimit(visitor(c))) return c.json({ error: 'Too many requests. Try again in a minute.' }, 429);
    const db = await database();
    if (!db) return c.json({ error: 'Feed not configured' }, 503);
    const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query('limit') || '30', 10) || 30));
    const beforeRaw = c.req.query('before');
    const before = beforeRaw && /^\d{1,18}$/.test(beforeRaw) ? beforeRaw : null;
    const rows = await db.query(`SELECT l.id, l.source, l.pool, l.hook, l.fee, l.block_number, l.block_time, l.deployer,
        ${NEW_TOKEN_SQL} AS token, t.name, t.symbol, t.decimals, t.total_supply,
        CASE WHEN l.deployer IS NULL THEN NULL ELSE (SELECT count(*)::int FROM launches d WHERE d.deployer = l.deployer) END AS deployer_launches
      FROM launches l LEFT JOIN tokens t ON t.address = ${NEW_TOKEN_SQL}
      WHERE ($2::bigint IS NULL OR l.id < $2::bigint)
      ORDER BY l.id DESC LIMIT $3`, [feed.baseTokens, before, limit]);
    const [status] = await db.query('SELECT max(updated_at) AS updated_at FROM index_cursor');
    c.header('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    return c.json({
      updatedAt: status?.updated_at ? new Date(status.updated_at).toISOString() : null,
      disclaimer: DISCLAIMER,
      launches: rows.map((row) => ({
        id: String(row.id),
        source: row.source,
        pool: row.pool,
        token: row.token,
        name: row.name,
        symbol: row.symbol,
        decimals: row.decimals,
        totalSupply: row.total_supply,
        hook: row.hook,
        fee: feeLabel(row.source, row.fee),
        block: Number(row.block_number),
        time: row.block_time ? new Date(row.block_time).toISOString() : null,
        deployer: row.deployer,
        deployerLaunches: row.deployer_launches,
      })),
      next: rows.length === limit ? String(rows[rows.length - 1].id) : null,
    });
  });

  app.post('/api/launches/refresh', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!refreshLimit(visitor(c))) return c.json({ status: 'wait', error: 'One refresh a minute.' }, 429);
    const db = await database();
    if (!db) return c.json({ error: 'Feed not configured' }, 503);
    const [status] = await db.query(`SELECT max(updated_at) > now() - interval '3 minutes' AS fresh FROM index_cursor`);
    if (status?.fresh) return c.json({ status: 'fresh' });
    const result = await run(db, 'refresh', 15);
    return c.json({ status: result.skipped ? 'busy' : 'updated', stopped: result.stopped ?? null });
  });
}
