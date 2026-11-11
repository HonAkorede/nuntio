import rawChains from './data/chains.json';
import { linkFor } from './scan-model.js';

/** Launches tab: new Uniswap pools on Elysium from the Nuntio API.
 * Every value from the API is chain data, so it is escaped and shown as plain text only. */

const SOURCE_LABELS = /** @type {Record<string, string>} */ ({ 'uniswap-v2': 'Uniswap v2', 'uniswap-v3': 'Uniswap v3', 'uniswap-v4': 'Uniswap v4' });
const ADDRESS = /^0x[0-9a-f]{40}$/i;

/** @param {string | null | undefined} value */
const short = (value) => (value && value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || '');

/** @param {string | null} iso @param {number} [now] */
export function ago(iso, now = Date.now()) {
  if (!iso) return 'time unknown';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * @param {{ app: HTMLElement, icon: (name: string, className?: string) => string, announce: (message: string) => void, esc: (value: string) => string, homeHref: (path?: string) => string }} deps
 */
export function createLaunchesView({ app, icon, announce, esc, homeHref }) {
  const elysium = rawChains.chains.find(({ id }) => id === 'elysium');

  /** @param {any} launch */
  function card(launch) {
    const token = ADDRESS.test(launch.token) ? launch.token : '';
    const symbol = launch.symbol ? esc(launch.symbol) : 'Unnamed token';
    const scan = token ? homeHref(`/scan?chain=elysium&address=${token}`) : '';
    const explorer = token && elysium ? linkFor(elysium.explorer.token, token) : '';
    const deployerNote = launch.deployer
      ? `<code>${esc(short(launch.deployer))}</code> <span class="muted">· ${Number(launch.deployerLaunches) || 1} ${Number(launch.deployerLaunches) === 1 ? 'pool' : 'pools'} from this wallet in the last 14 days</span>`
      : '<span class="muted">Not read yet</span>';
    return `<li class="launch-card">
      <div class="launch-top"><div><h2>${symbol}</h2>${launch.name ? `<p class="launch-name">${esc(launch.name)}</p>` : ''}</div><time datetime="${esc(launch.time || '')}">${esc(ago(launch.time))}</time></div>
      <dl class="launch-facts">
        <div><dt>Token</dt><dd><code>${esc(short(token) || 'unknown')}</code></dd></div>
        <div><dt>Pool</dt><dd>${esc(SOURCE_LABELS[launch.source] || 'Uniswap')} · fee ${esc(String(launch.fee))}</dd></div>
        ${launch.hook && launch.hook !== '0x0000000000000000000000000000000000000000' ? `<div><dt>Hook</dt><dd><code>${esc(short(launch.hook))}</code></dd></div>` : ''}
        <div><dt>Deployer</dt><dd>${deployerNote}</dd></div>
      </dl>
      <div class="launch-actions">${scan ? `<a class="button secondary" href="${esc(scan)}">Scan and research ${icon('arrow')}</a>` : ''}${explorer ? `<a class="text-link" href="${esc(explorer)}" target="_blank" rel="noopener noreferrer">Explorer ${icon('external')}<span class="sr-only"> (opens in new tab)</span></a>` : ''}</div>
    </li>`;
  }

  /** @param {string} [before] */
  async function load(before) {
    const url = `/api/launches?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function renderLaunches() {
    document.title = 'New on Elysium | nuntio';
    app.innerHTML = `<div class="wrap launches"><h1 id="page-title" tabindex="-1">New on Elysium.</h1>
      <p class="guide-intro">New Uniswap pools on Elysium, read straight from the chain. Starting points for your own research, not picks.</p>
      <p class="risk-note">${icon('warning')}<span id="launch-disclaimer">New tokens are very high risk. A listing here is not an endorsement, and a clean result does not mean safe. Not financial advice.</span></p>
      <div class="launch-status"><p id="launch-updated" role="status">Loading the feed…</p><button class="button secondary" type="button" id="launch-refresh">Check for new launches</button></div>
      <ul class="launch-list" id="launch-list"></ul>
      <button class="button secondary" type="button" id="launch-more" hidden>Show older launches</button>
      <p class="small muted launch-sources">Sources: the Uniswap v2, v3 and v4 contracts that Uniswap publishes for Elysium. Other launchpads are added only when their official docs list Elysium contracts. A v4 hook is a contract that changes how a pool works; it is shown as an address because no official source names it. Deployer counts only cover the last 14 days of this feed.</p></div>`;
    const list = /** @type {HTMLElement} */ (app.querySelector('#launch-list'));
    const updated = /** @type {HTMLElement} */ (app.querySelector('#launch-updated'));
    const more = /** @type {HTMLButtonElement} */ (app.querySelector('#launch-more'));
    const refresh = /** @type {HTMLButtonElement} */ (app.querySelector('#launch-refresh'));
    /** @type {string | null} */ let next = null;

    /** @param {any} body @param {boolean} append */
    function show(body, append) {
      const items = Array.isArray(body.launches) ? body.launches : [];
      if (!append) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', items.map(card).join(''));
      if (!append && !items.length) list.innerHTML = '<li class="launch-empty">No launches stored yet. The feed fills in after its next update.</li>';
      updated.textContent = body.updatedAt ? `Updated ${ago(body.updatedAt)}. The feed checks the chain every 15 minutes.` : 'Not updated yet.';
      next = typeof body.next === 'string' ? body.next : null;
      more.hidden = !next;
    }
    function unavailable() {
      updated.textContent = 'The live feed is not available here. It needs the Nuntio server, so it works on the hosted site but not on a static copy.';
      refresh.hidden = true;
    }
    load().then((body) => show(body, false)).catch(unavailable);

    more.addEventListener('click', async () => {
      if (!next) return;
      more.disabled = true;
      try { show(await load(next), true); announce('Older launches added.'); } catch { announce('Could not load older launches.'); } finally { more.disabled = false; }
    });
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      updated.textContent = 'Checking the chain…';
      try {
        const response = await fetch('/api/launches/refresh', { method: 'POST', credentials: 'omit' });
        const result = await response.json().catch(() => ({}));
        show(await load(), false);
        announce(result.status === 'wait' ? 'You can check again in a minute.' : 'Feed checked.');
      } catch { unavailable(); } finally { setTimeout(() => { refresh.disabled = false; }, 60000); }
    });
  }

  return { renderLaunches };
}
