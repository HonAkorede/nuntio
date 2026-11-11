import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { feedFromEnv } from './feed/config.js';
import { ConfigError, loadEnv } from './env.js';
import { VERSION as version } from './version.js';

/** Start the server: `npm start` (production) or `npm run dev` (reads a local .env file if present). */
let config;
try {
  config = loadEnv();
} catch (error) {
  if (error instanceof ConfigError) { console.error(`Settings problem: ${error.message}`); process.exit(1); }
  throw error;
}
const app = createApp({ distDir: fileURLToPath(new URL('../dist/', import.meta.url)), version, feed: feedFromEnv(config) });
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Nuntio server ${version} on http://localhost:${port}`);
  console.log(`Settings: ${config.summary()}`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
