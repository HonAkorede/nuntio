/** Read many token facts in one eth_call through Multicall3 (listed in Kinetiq's official
 * contract addresses page). Encoding and decoding are done by hand, with strict checks. */
import { decodeString, decodeUint, cleanText } from '../../src/scan-model.js';

export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
const AGGREGATE3 = '82ad56cb';
const SELECTORS = { name: '06fdde03', symbol: '95d89b41', decimals: '313ce567', totalSupply: '18160ddd' };

const word = (/** @type {number | bigint} */ value) => BigInt(value).toString(16).padStart(64, '0');

/** aggregate3((address target, bool allowFailure, bytes callData)[]) with allowFailure = true.
 * @param {{ target: string, data: string }[]} calls */
export function encodeAggregate3(calls) {
  const tuples = calls.map(({ target, data }) => {
    if (!/^0x[0-9a-f]{40}$/i.test(target) || !/^[0-9a-f]*$/i.test(data) || data.length % 2) throw new Error('Bad multicall input');
    const bytes = data.length / 2;
    return word(BigInt(target)) + word(1) + word(0x60) + word(bytes) + data.padEnd(Math.ceil(bytes / 32) * 64, '0');
  });
  let offset = calls.length * 32;
  const offsets = tuples.map((tuple) => { const at = word(offset); offset += tuple.length / 2; return at; });
  return AGGREGATE3 + word(0x20) + word(calls.length) + offsets.join('') + tuples.join('');
}

/** Decode (bool success, bytes returnData)[]; returns null for anything malformed.
 * @param {string} hex @param {number} expected @returns {({ success: boolean, data: string })[] | null} */
export function decodeAggregate3(hex, expected) {
  if (typeof hex !== 'string' || !/^0x([0-9a-f]{64})+$/i.test(hex)) return null;
  const body = hex.slice(2);
  const at = (/** @type {number} */ byte) => { const value = body.slice(byte * 2, byte * 2 + 64); return value.length === 64 ? BigInt(`0x${value}`) : null; };
  const start = at(0);
  if (start !== 32n) return null;
  const count = at(32);
  if (count !== BigInt(expected)) return null;
  const base = 64;
  const out = [];
  for (let index = 0; index < expected; index++) {
    const rel = at(base + index * 32);
    if (rel === null || rel > BigInt(body.length / 2)) return null;
    const tuple = base + Number(rel);
    const success = at(tuple);
    const dataRel = at(tuple + 32);
    if (success === null || (success !== 0n && success !== 1n) || dataRel !== 64n) return null;
    const length = at(tuple + 64);
    if (length === null || length > 4096n) return null;
    const data = body.slice((tuple + 96) * 2, (tuple + 96) * 2 + Number(length) * 2);
    if (data.length !== Number(length) * 2) return null;
    out.push({ success: success === 1n, data: `0x${data}` });
  }
  return out;
}

/** Token facts as plain, cleaned text. A field that does not answer stays null.
 * @param {{ call: (method: string, params: unknown[]) => Promise<any> }} rpc @param {string[]} tokens */
export async function readTokens(rpc, tokens) {
  const keys = /** @type {(keyof typeof SELECTORS)[]} */ (Object.keys(SELECTORS));
  const calls = tokens.flatMap((target) => keys.map((key) => ({ target, data: SELECTORS[key] })));
  const result = await rpc.call('eth_call', [{ to: MULTICALL3, data: `0x${encodeAggregate3(calls)}` }, 'latest']);
  const decoded = decodeAggregate3(result, calls.length);
  if (!decoded) throw new Error('Malformed multicall answer');
  return tokens.map((address, index) => {
    const part = (/** @type {number} */ offset) => { const item = decoded[index * keys.length + offset]; return item.success && item.data !== '0x' ? item.data : null; };
    const name = part(0) ? decodeString(/** @type {string} */ (part(0))) : null;
    const symbol = part(1) ? decodeString(/** @type {string} */ (part(1))) : null;
    const decimals = part(2) ? decodeUint(/** @type {string} */ (part(2))) : null;
    const supply = part(3) ? decodeUint(/** @type {string} */ (part(3))) : null;
    return {
      address,
      name: name ? cleanText(name).slice(0, 64) || null : null,
      symbol: symbol ? cleanText(symbol).slice(0, 24) || null : null,
      decimals: decimals !== null && decimals <= 255n ? Number(decimals) : null,
      totalSupply: supply !== null ? supply.toString() : null,
    };
  });
}
