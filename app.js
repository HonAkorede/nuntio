// Vercel entrypoint. Vercel finds this file because it imports hono, and runs the
// default export as a Vercel Function. The static site is served separately by
// Vercel's CDN from public/ (a copy of dist/ made by `npm run build:vercel`).
// For local use and other hosts, run `npm run dev` or `npm start` (server/index.js).
import { Hono } from 'hono';
import { createApp } from './server/app.js';

/** @type {Hono} */
const app = createApp();
export default app;
