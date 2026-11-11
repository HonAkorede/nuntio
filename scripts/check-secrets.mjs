import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Patterns for common API keys and private keys. A match fails CI so nothing secret is committed. */
const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI style API key', /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['Database URL with a password', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/],
];

/** @param {string} path @param {string} text @returns {string[]} */
export function findSecrets(path, text) {
  const name = basename(path);
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return [`${path}: a real .env file must never be committed`];
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => `${path}: looks like a ${label}`);
}

// Run directly: check every file git would commit (tracked plus new, not ignored).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const problems = [];
  for (const file of files) {
    if (/\.(png|jpe?g|gif|ico|woff2?)$/i.test(file) || file === 'tests/server.test.mjs') continue;
    let text;
    try { text = readFileSync(new URL(file, `file:///${root.replace(/\\/g, '/')}`), 'utf8'); } catch { continue; }
    problems.push(...findSecrets(file, text));
  }
  if (problems.length) { console.error(`Possible secrets found. Remove them and rotate the keys:\n${problems.join('\n')}`); process.exit(1); }
  console.log(`No secrets found in ${files.length} files.`);
}
