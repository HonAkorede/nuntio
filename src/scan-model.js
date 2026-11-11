/** Pure helpers for the Scan tab. Nothing here touches the DOM or the network. */

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
export const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SELECTORS = { name: '0x06fdde03', symbol: '0x95d89b41', decimals: '0x313ce567', totalSupply: '0x18160ddd', owner: '0x8da5cb5b' };

/** @param {string} text @returns {Uint8Array | null} */
export function base58Decode(text) {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  for (const char of text) { if (char !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

/** @param {Uint8Array} bytes */
export function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let text = '';
  while (value > 0n) { text = BASE58[Number(value % 58n)] + text; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = `1${text}`; }
  return text;
}

/** @param {'evm' | 'solana'} kind @param {string} raw @returns {{ ok: true, address: string } | { ok: false, error: string }} */
export function validateAddress(kind, raw) {
  const address = raw.trim();
  if (!address) return { ok: false, error: 'Enter an address to scan.' };
  const looksEvm = /^0x/i.test(address);
  if (kind === 'evm') {
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: true, address };
    if (!looksEvm && base58Decode(address)?.length === 32) return { ok: false, error: 'This looks like a Solana address. Choose Solana, or enter a 0x address with 40 hex characters.' };
    return { ok: false, error: 'Use a 0x address with 40 hex characters (0-9, a-f).' };
  }
  if (looksEvm) return { ok: false, error: 'This looks like an EVM address. Choose an EVM chain, such as Ethereum, Base or Elysium.' };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && base58Decode(address)?.length === 32) return { ok: true, address };
  return { ok: false, error: 'Use a Solana address: 32 to 44 base58 characters, with no 0, O, I or l.' };
}

/** @param {string} hex */
function hexBytes(hex) {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Strip control characters so untrusted token strings stay plain, single-line text.
 * @param {string} text */
export function cleanText(text) {
  return text.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 80);
}

/** Decode an ABI string return value, with the legacy bytes32 form as a fallback.
 * @param {string} hex @returns {string | null} */
export function decodeString(hex) {
  if (!/^0x[0-9a-fA-F]+$/.test(hex) || hex.length < 66 || (hex.length - 2) % 64) return null;
  const bytes = hexBytes(hex);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    if (bytes.length === 32) {
      const zero = bytes.indexOf(0);
      if (zero !== -1 && bytes.slice(zero).some((byte) => byte !== 0)) return null;
      return cleanText(decoder.decode(zero === -1 ? bytes : bytes.slice(0, zero)));
    }
    const offset = BigInt(`0x${hex.slice(2, 66)}`);
    const length = BigInt(`0x${hex.slice(66, 130)}`);
    if (offset !== 32n || length > BigInt(bytes.length - 64)) return null;
    const end = 64 + Number(length);
    if (bytes.length !== 64 + Math.ceil(Number(length) / 32) * 32 || bytes.slice(end).some((byte) => byte !== 0)) return null;
    return cleanText(decoder.decode(bytes.slice(64, end)));
  } catch { return null; }
}

/** @param {string} hex @returns {bigint | null} */
export function decodeUint(hex) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return BigInt(hex);
}

/** @param {string} hex @returns {string | null} */
export function decodeAddress(hex) {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(hex)) return null;
  return `0x${hex.slice(26, 66)}`;
}

/** @param {bigint} value @param {number} decimals @param {number} [maxFraction] */
export function formatUnits(value, decimals, maxFraction = 6) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals ? (abs % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '') : '';
  if (abs > 0n && whole === '0' && !fraction) return `less than 0.${'0'.repeat(maxFraction - 1)}1`;
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Literal single-pass fill. Every placeholder must have a value.
 * @param {string} template @param {Record<string, string>} values */
export function fillScanTemplate(template, values) {
  return template.replace(/\{([a-z]+)\}/g, (_, key) => {
    if (!Object.hasOwn(values, key) || !String(values[key]).trim()) throw new Error(`Missing scan value: ${key}`);
    return values[key];
  });
}

/** @param {{ label: string, value: string }[]} facts */
export function factsSentence(facts) {
  return facts.map(({ label, value }) => `${label}: ${value}`).join('; ');
}

/** @param {string} template @param {string} address */
export function linkFor(template, address) { return template.replace('{address}', encodeURIComponent(address)); }

/* Ed25519 curve check, as Solana uses for program-derived addresses. */
const P = 2n ** 255n - 19n;
/** @param {bigint} base @param {bigint} exponent */
function modPow(base, exponent) {
  let result = 1n;
  let b = ((base % P) + P) % P;
  let e = exponent;
  while (e > 0n) { if (e & 1n) result = (result * b) % P; b = (b * b) % P; e >>= 1n; }
  return result;
}
const D = ((-121665n * modPow(121666n, P - 2n)) % P + P) % P;
const SQRT_M1 = modPow(2n, (P - 1n) / 4n);

/** @param {Uint8Array} bytes */
export function isOnCurve(bytes) {
  let y = 0n;
  for (let index = 31; index >= 0; index--) y = (y << 8n) + BigInt(index === 31 ? bytes[index] & 0x7f : bytes[index]);
  y %= P;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const v3 = (v * v % P) * v % P;
  const v7 = (v3 * v3 % P) * v % P;
  let x = (u * v3 % P) * modPow(u * v7 % P, (P - 5n) / 8n) % P;
  const check = (v * x % P) * x % P;
  if (check === u) return true;
  if (check === (P - u) % P) { x = x * SQRT_M1 % P; return true; }
  return false;
}

/** @param {Uint8Array[]} seeds @param {Uint8Array} programId @param {(data: Uint8Array) => Promise<Uint8Array>} sha256 */
export async function findProgramAddress(seeds, programId, sha256) {
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), programId, marker];
    const data = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.length; }
    const hash = await sha256(data);
    if (!isOnCurve(hash)) return base58Encode(hash);
  }
  throw new Error('No program address found');
}

/** Read name and symbol from a Metaplex token metadata account.
 * @param {Uint8Array} data @returns {{ name: string, symbol: string } | null} */
export function parseMetadata(data) {
  if (data.length < 69 || data[0] !== 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 65;
  /** @returns {string | null} */
  const read = () => {
    if (offset + 4 > data.length) return null;
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > data.length) return null;
    const text = decoder.decode(data.slice(offset, offset + length)).replace(/\0/g, '');
    offset += length;
    return cleanText(text);
  };
  const name = read();
  const symbol = read();
  return name === null || symbol === null ? null : { name, symbol };
}

/** @param {string} base64 */
export function base64Bytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Hash state for a saved trader profile, in the same query format as the other playbooks.
 * @param {string} view @param {Record<string, string>} values */
export function scanHash(view, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, value);
  return `#${view}?${params}`;
}
