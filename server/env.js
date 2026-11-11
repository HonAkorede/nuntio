/** Server settings. Values come only from environment variables, never from code or the repo.
 * Secret values are never logged, returned by an endpoint or included in an error message. */

/** @typedef {{ name: string, required: boolean, secret: boolean, fallback?: string, about: string }} Setting */

/** @type {Setting[]} Add new settings here and to .env.example. */
export const SETTINGS = [
  { name: 'PORT', required: false, secret: false, fallback: '3000', about: 'Port the server listens on. Most hosts set this for you.' },
  { name: 'NODE_ENV', required: false, secret: false, fallback: 'development', about: 'development or production.' },
  { name: 'DATABASE_URL', required: false, secret: true, about: 'Postgres connection string for the launch feed. Vercel sets it when you add Neon.' },
  { name: 'CRON_SECRET', required: false, secret: true, about: 'Random string of at least 16 characters. Vercel sends it with each scheduled update.' },
  { name: 'ELYSIUM_RPC_URL', required: false, secret: false, fallback: 'https://rpc.elysium.kinetiq.xyz', about: 'Elysium RPC used by the server. Defaults to the official public RPC.' },
];

export class ConfigError extends Error {}

/** Read and check settings. Throws ConfigError naming any problem setting, never its value.
 * @param {Record<string, string | undefined>} [source] */
export function loadEnv(source = process.env) {
  /** @type {Record<string, string | undefined>} */
  const values = {};
  const missing = [];
  for (const setting of SETTINGS) {
    const raw = source[setting.name];
    const value = raw === undefined || raw.trim() === '' ? setting.fallback : raw.trim();
    if (value === undefined && setting.required) missing.push(setting.name);
    values[setting.name] = value;
  }
  if (missing.length) throw new ConfigError(`Missing required settings: ${missing.join(', ')}. See .env.example.`);
  const port = Number(values.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('PORT must be a whole number from 1 to 65535.');
  if (!['development', 'production', 'test'].includes(String(values.NODE_ENV))) throw new ConfigError('NODE_ENV must be development, production or test.');
  if (values.CRON_SECRET !== undefined && values.CRON_SECRET.length < 16) throw new ConfigError('CRON_SECRET must be at least 16 characters.');
  let rpcUrl;
  try { rpcUrl = new URL(String(values.ELYSIUM_RPC_URL)); } catch { throw new ConfigError('ELYSIUM_RPC_URL must be a full https address.'); }
  if (rpcUrl.protocol !== 'https:') throw new ConfigError('ELYSIUM_RPC_URL must be a full https address.');
  return Object.freeze({
    port,
    nodeEnv: /** @type {'development' | 'production' | 'test'} */ (values.NODE_ENV),
    databaseUrl: values.DATABASE_URL,
    cronSecret: values.CRON_SECRET,
    elysiumRpcUrl: rpcUrl.href,
    /** Safe to log: shows which settings are set, with secrets hidden. */
    summary() {
      return SETTINGS.map(({ name, secret }) => `${name}=${values[name] === undefined ? '(not set)' : secret ? '(set, hidden)' : values[name]}`).join(' ');
    },
  });
}
