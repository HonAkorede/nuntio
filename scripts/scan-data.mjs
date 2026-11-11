import assert from 'node:assert/strict';

/** Fail the build on an incomplete chain or scan catalog. */
export function validateScanData(chains, scan) {
  assert.equal(chains.version, 1, 'Unsupported chain catalog version');
  const ids = new Set();
  for (const chain of chains.chains) {
    assert.match(chain.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(chain.id), `Duplicate chain: ${chain.id}`);
    ids.add(chain.id);
    assert.ok(['evm', 'solana'].includes(chain.kind), `Unknown chain kind: ${chain.id}`);
    assert.ok(chain.label && chain.nativeSymbol && Number.isInteger(chain.nativeDecimals));
    if (chain.kind === 'evm') assert.ok(Number.isInteger(chain.chainId) && chain.chainId > 0, `${chain.id}: EVM chains need their documented numeric chainId`);
    // One official RPC is allowed when the chain documents no public fallback; never more than two.
    assert.ok([1, 2].includes(chain.rpc.length), `${chain.id}: give a main RPC and at most one fallback`);
    assert.equal(new Set(chain.rpc.map((url) => new URL(url).href)).size, chain.rpc.length, `${chain.id}: main and fallback RPCs must be distinct`);
    for (const url of [...chain.rpc, ...chain.rpcSources]) assert.equal(new URL(url).protocol, 'https:', `${chain.id}: RPCs and sources must use HTTPS`);
    assert.ok(chain.rpcSources.length, `${chain.id}: record where the RPC is documented`);
    for (const key of ['address', 'token']) {
      assert.equal(new URL(chain.explorer[key].replace('{address}', 'x')).protocol, 'https:');
      assert.ok(chain.explorer[key].includes('{address}'), `${chain.id}: explorer ${key} needs {address}`);
    }
  }
  for (const tool of Object.values(chains.tools)) assert.equal(new URL(tool.url).protocol, 'https:');
  assert.equal(scan.version, 1);
  assert.equal(scan.items.length, 5, 'The token menu has five checks');
  for (const item of scan.items) {
    assert.ok(item.id && item.title && item.item && item.method);
    assert.ok(item.tool === null || ['explorer-address', 'explorer-token'].includes(item.tool) || chains.tools[item.tool], `Unknown tool: ${item.tool}`);
  }
  assert.deepEqual(new Set([...scan.tokenPromptTemplate.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1])), new Set(['item', 'address', 'chain', 'facts', 'method']));
  assert.deepEqual(new Set([...scan.walletPromptTemplate.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1])), new Set(['address', 'chain']));
}

/** Origins the static page may read from. Everything else stays blocked by the CSP. */
export function rpcOrigins(chains) {
  return [...new Set(chains.chains.flatMap((chain) => chain.rpc.map((url) => new URL(url).origin)))];
}
