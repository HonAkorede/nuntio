import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Vercel serves static files only from public/. Copy the built site there.
 * public/ is generated and ignored by git; dist/ stays the source of truth (and the IPFS export). */
const project = fileURLToPath(new URL('../', import.meta.url));
await rm(`${project}public`, { recursive: true, force: true });
await cp(`${project}dist`, `${project}public`, { recursive: true });
console.log('Copied dist/ to public/ for Vercel.');
