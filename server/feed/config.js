import launchSources from '../../src/data/launch-sources.json' with { type: 'json' };
import { neonDb } from '../db.js';

/** Feed settings from the environment. The database is created on first use, so a missing
 * DATABASE_URL only disables the feed routes (they answer 503) instead of stopping the server.
 * @param {ReturnType<typeof import('../env.js').loadEnv>} config */
export function feedFromEnv(config) {
  /** @type {import('../db.js').Db | null} */
  let db = null;
  return {
    getDb: () => (config.databaseUrl ? (db ??= neonDb(config.databaseUrl)) : null),
    cronSecret: config.cronSecret,
    rpcUrl: config.elysiumRpcUrl,
    sources: launchSources.sources,
    baseTokens: launchSources.baseTokens.addresses,
  };
}
