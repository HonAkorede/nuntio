// Vercel Function for every /api/* request (vercel.json rewrites /api/* here; the
// original path is kept, so the Hono routes in server/app.js still match).
// The static site is served separately by Vercel's CDN from public/.
// For local use and other hosts, run `npm run dev` or `npm start` (server/index.js).
import { createApp } from '../server/app.js';
import { loadEnv } from '../server/env.js';
import { feedFromEnv } from '../server/feed/config.js';

const app = createApp({ feed: feedFromEnv(loadEnv()) });

/** @param {Request} request */
const handle = (request) => app.fetch(request);

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
