/** Server side JSON RPC client for Elysium. Every reply is checked; chain data is untrusted.
 * Counts calls so each run can stay inside a budget and log its usage. */

export class RpcError extends Error {
  /** @param {string} message @param {number | null} [code] */
  constructor(message, code = null) { super(message); this.code = code; }
}

/** @param {string} url @param {{ fetcher?: typeof fetch, timeoutMs?: number, maxCalls?: number }} [options] */
export function createRpc(url, { fetcher = fetch, timeoutMs = 20000, maxCalls = 60 } = {}) {
  let calls = 0;
  /** @param {unknown} body */
  async function post(body) {
    if (calls >= maxCalls) throw new RpcError('RPC call budget for this run is used up');
    calls++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new RpcError(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw error instanceof RpcError ? error : new RpcError(`RPC request failed: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally { clearTimeout(timer); }
  }
  /** @param {any} reply @param {number} id */
  function unwrap(reply, id) {
    if (!reply || typeof reply !== 'object' || reply.jsonrpc !== '2.0' || reply.id !== id) throw new RpcError('Malformed RPC answer');
    if (reply.error) throw new RpcError(String(reply.error.message || 'RPC error').slice(0, 200), typeof reply.error.code === 'number' ? reply.error.code : null);
    if (!Object.hasOwn(reply, 'result')) throw new RpcError('Malformed RPC answer');
    return reply.result;
  }
  return {
    get calls() { return calls; },
    get remaining() { return Math.max(0, maxCalls - calls); },
    /** @param {string} method @param {unknown[]} params */
    async call(method, params) { return unwrap(await post({ jsonrpc: '2.0', id: 1, method, params }), 1); },
    /** One HTTP request for many reads. Returns results in order; a failed item becomes an RpcError value.
     * @param {[string, unknown[]][]} requests */
    async batch(requests) {
      if (!requests.length) return [];
      const replies = await post(requests.map(([method, params], index) => ({ jsonrpc: '2.0', id: index + 1, method, params })));
      if (!Array.isArray(replies)) throw new RpcError('Malformed batch answer');
      const byId = new Map(replies.filter((reply) => reply && typeof reply === 'object').map((reply) => [reply.id, reply]));
      return requests.map((_, index) => { try { return unwrap(byId.get(index + 1), index + 1); } catch (error) { return error; } });
    },
  };
}
