import { neon } from '@neondatabase/serverless';

/** A tiny database interface: query(text, params) resolves to an array of row objects.
 * Production uses Neon over HTTPS (works inside Vercel Functions). Tests pass an in memory Postgres.
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<Record<string, any>[]> }} Db */

/** @param {string} url @returns {Db} */
export function neonDb(url) {
  const sql = neon(url);
  return { query: async (text, params = []) => /** @type {Record<string, any>[]} */ (await sql.query(text, params)) };
}

/** Tables are created if missing, so running this again is safe. */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS index_cursor (
    source text PRIMARY KEY,
    last_block bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS launches (
    id bigserial PRIMARY KEY,
    source text NOT NULL,
    pool text NOT NULL,
    token0 text NOT NULL,
    token1 text NOT NULL,
    hook text,
    fee integer,
    block_number bigint NOT NULL,
    block_time timestamptz,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    deployer text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tx_hash, log_index)
  )`,
  'CREATE INDEX IF NOT EXISTS launches_block_idx ON launches (block_number DESC)',
  'CREATE INDEX IF NOT EXISTS launches_deployer_idx ON launches (deployer)',
  `CREATE TABLE IF NOT EXISTS tokens (
    address text PRIMARY KEY,
    name text,
    symbol text,
    decimals integer,
    total_supply text,
    read_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE TABLE IF NOT EXISTS index_lock (id integer PRIMARY KEY, until timestamptz NOT NULL)',
  `CREATE TABLE IF NOT EXISTS rpc_usage (
    day date NOT NULL,
    purpose text NOT NULL,
    calls integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, purpose)
  )`,
];

/** @param {Db} db */
export async function migrate(db) {
  for (const statement of SCHEMA) await db.query(statement);
}
