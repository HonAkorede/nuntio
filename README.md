# nuntio

**Tell your bot what to do.**

A small, static playbook generator for beginners using Grok Bot, with a read-only address scanner and setup guides for Binance, Coinbase and OKX Agentic Wallets. Choose a goal and customize a playbook, scan an address to build a research prompt, or copy a guide prompt to work through setup with your own agent. Each wallet guide also has a numbered checklist. Nothing runs or connects to an assistant or wallet from this site.

The complete production site is in [`dist/`](dist/). Source is in [`src/`](src/); playbooks and assistant configuration live in [`src/data/playbooks.json`](src/data/playbooks.json), setup guides in [`src/data/guides.json`](src/data/guides.json), chains in [`src/data/chains.json`](src/data/chains.json), and scan prompts in [`src/data/scan.json`](src/data/scan.json). Playbook generation stays in the browser. Scan makes read-only JSON-RPC API calls directly to the selected chain's public provider and, on failure, one distinct fallback. Those providers receive the address being scanned. There are no external runtime dependencies, keys, cookies, analytics, wallet connectors, database or backend. Publication is handled after submission under the name **nuntio**.

The catalog has eleven playbooks, including **X growth sprint** and the on demand **Match research**. The roadmap lists everything that exists under Live automatically; Next, Later and Exploring come from [`src/data/roadmap.json`](src/data/roadmap.json).

## Run it

You need Node.js 22 or later.

```sh
npm ci                # install packages
npm run build         # build the static site into dist/
npm test              # unit tests
npm run typecheck     # type checks
npm run check-secrets # make sure no keys or .env files would be committed
npm run dev           # start the server on http://localhost:3000 (restarts on changes)
```

The server (in [`server/`](server/)) serves the site from `dist/` and a small JSON API under `/api`. Right now the API has one route, `GET /api/health`. It is research only: there are no wallet, signing, trading or custody routes.

**Settings.** Copy [`.env.example`](.env.example) to `.env` for local use. On a host, set the same names as environment variables in its dashboard. API keys and passwords live only there, never in code, the repo or logs. The server refuses to start with a bad setting and never prints secret values. `.env` is ignored by git, and `npm run check-secrets` fails if one is about to be committed.

**CI.** Every push runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml): secret check, type checks, unit tests, a build, a check that `dist/` matches the source, and a server health check.

**Cost per request.** The server uses no paid data providers. It reads the official public Elysium RPC (free, shared by everyone, rate limited) and a Neon Postgres database on the free plan. Every run records its RPC requests in the `rpc_usage` table.

| Route | Who calls it | RPC requests | Database |
| --- | --- | --- | --- |
| `GET /api/health` | Anyone | 0 | 0 |
| `GET /api/cron/index` | Vercel Schedule every 15 minutes, with `CRON_SECRET` | At most 60 (a live 7 minute window used 17) | A few queries |
| `GET /api/launches` | The Launches tab | 0 | 2 queries; cached at the CDN for 30 seconds; 60 per minute per visitor |
| `POST /api/launches/refresh` | The "Check for new launches" button | 0 when the feed is under 3 minutes old, otherwise at most 15 | A few queries; once a minute per visitor |

## Elysium launch feed

The Launches tab lists new Uniswap pools on Elysium. [`src/data/launch-sources.json`](src/data/launch-sources.json) holds the only sources: the Uniswap v2, v3 and v4 contracts that Uniswap publishes for Elysium (chain 99901), plus the pairing tokens (HYPE, WHYPE, USDC) from Kinetiq's official contract list, so the other side of a pool is shown as the new token. Add a launchpad only when its own official docs publish its Elysium contracts, and never add a bridge address.

- [`server/feed/indexer.js`](server/feed/indexer.js) reads pool creation events in block ranges, checks every field, stores launches in Postgres and remembers where it stopped. It splits a range that returns too many events, retries rate limited lookups once, stops cleanly at its request budget, and keeps 14 days.
- Block times and deployers (the wallet that sent the creating transaction) come from batched lookups. Token name, symbol, decimals and supply come from one Multicall3 request per 50 tokens. Anything that cannot be read stays empty and is never guessed.
- Token names and symbols are untrusted chain data: they are cleaned, shown only as plain text and never passed to an AI as instructions. No owner of a wallet is guessed or shown.
- Uniswap v4 hooks are shown as addresses because no official source names them. A v4 fee of `dynamic` means the hook sets the fee.

**Setup on Vercel.** Add Neon from the project's Storage tab (it sets `DATABASE_URL`) and add a `CRON_SECRET` of at least 16 random characters under Settings, Environment Variables, then redeploy. The tables are created on first use. The schedule is defined in [`vercel.json`](vercel.json) (`schedules`, every 15 minutes, Hobby plan; Vercel does not retry a failed run, the next run catches up).

**Hosting: Vercel.** How it fits together:

- [`api/index.js`](api/index.js) is a Vercel Function. [`vercel.json`](vercel.json) sends every `/api/*` request to it, and it runs the same Hono app as `npm start`.
- The static site is served by Vercel's CDN from `public/`. [`vercel.json`](vercel.json) sets the build command to `npm run build:vercel`, which builds `dist/` and copies it to `public/`. `public/` is generated at deploy time and ignored by git. Source images live in [`brand/`](brand/).
- `dist/` stays in the repo as the source of truth and the IPFS export.

To deploy for the first time:

1. Sign in at vercel.com with GitHub and choose **Add New Project**, then import the `nuntio` repository.
2. Leave the build settings as they are. `vercel.json` sets the framework to none (Other), the build command and the `public` output folder, so the preset shown in the dashboard does not matter.
3. Add environment variables from `.env.example` under **Settings, Environment Variables** when a phase needs them (none are needed yet).
4. Deploy. Every push then gets a preview link, and the main branch goes to production.
5. Check `https://<your project>.vercel.app/api/health` answers `{"status":"ok",...}`.

`npm start` runs the same server on any other Node host, serving `dist/` itself.

## Install, build, and preview (original IMD notes)

Requires Node.js 22 or later and npm. Tooling is installed outside the repository so dependency and cache directories cannot enter the submission. No ignore file was added or changed.

```sh
mkdir -p /tmp/nuntio-tools
cp package.json package-lock.json /tmp/nuntio-tools/
npm ci --prefix /tmp/nuntio-tools --cache /tmp/nuntio-npm-cache
export PATH="/tmp/nuntio-tools/node_modules/.bin:$PATH"
export NODE_PATH="/tmp/nuntio-tools/node_modules"

npm run typecheck
npm test
npm run build
npm run preview
```

Preview opens a local static server at `http://localhost:4173`; visit that address in a browser. Stop with Ctrl+C. To use another port, run `npm run preview -- 4174`. This preview utility is development tooling, not a production server. Opening an ES-module website directly with `file://` is not supported; use HTTP or an IPFS gateway.

For ordinary local development outside the submission environment, `npm ci` in the repository also works; never include the resulting `node_modules/` or caches in a commit or upload.

`npm run build` validates the playbook, guide, chain and scan catalogs, bundles the vanilla JavaScript and CSS with esbuild, copies the favicon and social PNG, and generates the home page, nine playbook pages and three setup guide pages. It also regenerates each page's Content Security Policy (CSP) from the chain catalog's RPC origins. The build does not fetch data or require a browser. It replaces `dist/`; rebuild after source or JSON edits. Keep the complete `dist/` directory in the submitted repository alongside the source, manifest, and lockfile. The existing package manifest, lockfile and dependencies are unchanged by this update.

## Static routes and sharing

| Page | Exported path | Hash route |
| --- | --- | --- |
| Home | `dist/index.html` | `#/` |
| Scan | `dist/index.html` | `#/scan` |
| Saved trader profile | `dist/index.html` | `#/scan/output?chain=…&address=…&balance=…` |
| How it works and privacy | `dist/index.html` | `#/guide` |
| Setup guide library | `dist/index.html` | `#/guides` |
| Roadmap | `dist/index.html` | `#/roadmap` |
| Binance Agentic Wallet | `dist/guides/binance-agentic-wallet/index.html` | No hash required |
| Coinbase Agentic Wallet | `dist/guides/coinbase-agentic-wallet/index.html` | No hash required |
| OKX Agentic Wallet | `dist/guides/okx-agentic-wallet/index.html` | No hash required |
| Meme coin research digest | `dist/playbooks/meme-coin-research-digest/index.html` | `#/configure` or `#/output` |
| Content and reply drafts | `dist/playbooks/content-and-reply-drafts/index.html` | `#/configure` or `#/output` |
| Job hunt radar | `dist/playbooks/job-hunt-radar/index.html` | `#/configure` or `#/output` |
| Perps funding digest | `dist/playbooks/perps-funding-digest/index.html` | `#/configure` or `#/output` |
| New launch radar | `dist/playbooks/new-launch-radar/index.html` | `#/configure` or `#/output` |
| Tokenized stock watch | `dist/playbooks/tokenized-stock-watch/index.html` | `#/configure` or `#/output` |
| Unlock and airdrop tracker | `dist/playbooks/unlock-and-airdrop-tracker/index.html` | `#/configure` or `#/output` |
| Project research brief | `dist/playbooks/project-research-brief/index.html` | `#/configure` or `#/output` |
| Crypto creator thread writer | `dist/playbooks/crypto-creator-thread-writer/index.html` | `#/configure` or `#/output` |

Forms serialize their answers after the hash, for example `#/configure?experience=beginner&frequency=weekday&channel=Grok+Bot+chat&role=Designer&location=Remote`. Generation changes the hash to `/output`; edit, reload, and browser back retain the answers. **Copy share link** includes the actual gateway prefix, the playbook’s static filename, and the configured hash. It never invents a hostname or content ID.

The fragment is not sent in an HTTP request, but it is readable by anyone with the link and can remain in browser history. Avoid private information. nuntio stores nothing in local storage or cookies. Review checkboxes are intentionally temporary and are not included in shared links.

Scan validates an address before reading it. A complete result comes from one endpoint; a failed read restarts the whole scan on the fallback. Malformed replies and invalid ABI payloads are failures, while a genuine contract revert or valid empty return marks a field unavailable. If both reads fail, the page says “Could not read the chain right now” and shows no completed facts. Changing the address or chain clears the result and invalidates any pending response. Public RPC availability, CORS access and token metadata can vary. Scan needs network access; generating or reloading a saved prompt does not perform a scan. A saved trader profile contains the analyst prompt and the balance captured when saved; it does not contain completed agent research.

All asset paths are relative (`./assets/` or `../../assets/`). There are no route rewrites, root-relative assets, CDNs, or external fonts. Every static playbook and setup guide page contains its own title, description, Open Graph and X/Twitter tags, and a no-JavaScript text fallback. The locally bundled 1200 × 630 social image works without JavaScript. Preview tags describe the page; crawlers cannot see hash answers. An unknown hash shows a recovery link; an incomplete or malformed playbook output link returns to the form with a notice. Setup guides also support `#/guides/<id>` from the home document.

## Add a chain

1. Add an entry to `chains` in [`src/data/chains.json`](src/data/chains.json), retaining catalog `version: 1`. Give it a unique lowercase, hyphenated `id`, a display `label`, and `kind: "evm"` or `"solana"`. Set the documented numeric `chainId` for EVM, or `null` for Solana; set `nativeSymbol` and integer `nativeDecimals` for balance display.
2. Set `rpc` to one or two distinct public HTTPS URLs in primary, fallback order. Use two when the chain or a provider documents a public fallback; use one when only the official RPC is documented (Elysium lists only `https://rpc.elysium.kinetiq.xyz`, so it has no fallback and a failed read shows the error message). Never put a URL that needs an API key here, because Scan runs in the visitor's browser. Find each URL in the chain's official documentation or the provider's own documentation; do not infer hostnames. Record those official source pages in `rpcSources` and update `verifiedAt` when checked. The validator rejects duplicate URLs, including equivalent spellings with a trailing slash. The Robinhood fallback is `https://robinhood-rpc.publicnode.com`, published on [PublicNode's Robinhood page](https://robinhood.publicnode.com/); its primary is documented in [Robinhood's connection guide](https://docs.robinhood.com/chain/connecting).
3. Fill `explorer` with `name`, `address` and `token` HTTPS URL templates, each containing `{address}`. Verify the URL format on the explorer's own site. Tool homepages are in `tools`; do not guess deep links. Token check titles, methods and prompt templates are separate data in [`src/data/scan.json`](src/data/scan.json).
4. Existing EVM and Solana families use [`src/scan-rpc.js`](src/scan-rpc.js) and [`src/scan-model.js`](src/scan-model.js). A different address/account family also needs explicit validation, reading and result types; changing JSON alone cannot implement a new protocol. Keep provider values as plain text and preserve the complete-read/fallback behavior.
5. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run validate`, and `node scripts/validate-revision.mjs` with the tooling below. **Rebuild after editing RPC URLs**: the build derives `connect-src` from this catalog, so editing source JSON without regenerating `dist/` leaves the new origin blocked by the exported CSP. Review the static export at mobile and desktop widths and keep all of `dist/`.

## Add a setup guide

1. Copy an entry in `guides` in [`src/data/guides.json`](src/data/guides.json). Give it a unique lowercase, hyphenated `id`; the build uses that ID as its static folder name.
2. Set `title`, `description`, `note`, `risk`, `verifiedAt` (ISO date), and the HTTPS `sourceUrl`. Use only documented provider claims. Do not invent a risk rating: the Binance entry uses `null` because the assignment did not supply one; Coinbase and OKX use `medium`.
3. List the prerequisites in `beforeYouStart`. Add numbered `steps` in order, with `actor: "you"` or `actor: "agent"`, plain `text`, and a `commands` array (empty when no command is needed). Actors render as “You do this” and “Your agent does this.” Commands are selectable text, never executed. Angle-bracket arguments in the Coinbase checklist describe values from the visitor’s own login flow; the site does not collect them.
4. Add provider-specific `staySafe` rules. The shared `banner`, `safetyRules`, and `reportUrl` apply to every guide. Keep the VPN, unofficial-source, unknown-Telegram-bot, secret-protection and approval rules.
5. Fill the guide’s `prompt` object with all six strings: `provider`, `install`, `node`, `human_steps`, `signin`, and `verify`. The `provider` must match `title`.
6. Keep `promptTemplate` as the requested shared template. [`src/guide-model.js`](src/guide-model.js) substitutes the values literally in one pass, including the underscore in `{human_steps}`. Agent mode is the default on every visit; it shows one complete prompt and one copy button. Clipboard denial opens a selectable manual-copy field. “Do it yourself” reveals the checklist. Checks survive switching modes and reset when the page is left or reloaded.
7. Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run validate` with the tooling above. Run `node scripts/review.mjs` for the guide first-screen, contrast and roadmap checks. Cards, static guide HTML, source/report links, dates and both modes are generated from the catalog; no route or render changes are needed for another guide. Extend the acceptance fixtures when intentionally extending the catalog.

The build rejects incomplete catalogs, duplicate IDs, missing prompt values, missing steps and unknown step actors. Never store account emails, codes, funds, addresses or secrets in this JSON. A guide is an instruction for a visitor’s own agent; it is not a wallet integration. No wallet CLI or provider skill is installed by the website or its build.

Official sources linked by the guides, checked on 29 Oct 2026:

- [Binance Skills Hub](https://www.binance.com/en/skills/detail/binance-web3/binance-agentic-wallet).
- [Coinbase quickstart](https://docs.cdp.coinbase.com/agentic-wallet/quickstart) (currently redirects to its CLI quickstart).
- [OKX installation guide](https://web3.okx.com/onchainos/dev-docs/home/install-your-agentic-wallet).

Provider text and commands follow the assignment. The current OKX page recommends a different installer; this delivery retains the assignment’s explicit `npx skills add okx/onchainos-skills` command rather than broadening installation. No live account setup was performed. Each card says “Last verified 29 Oct 2026” as requested; this does not certify a provider’s future availability.

## Add a playbook

1. Copy an object in `playbooks` in `src/data/playbooks.json`.
2. Give it a unique lowercase, hyphenated `id`, a `title`, short `description`, `category`, and an existing `agentId`. The ID becomes the exported folder name.
3. Add `keywords`. Matching is case-insensitive, normalizes accents and punctuation, and matches complete words or phrases. A matched phrase scores its word count; results are sorted by total score with catalog order breaking ties. The top three positive matches are shown. No match means an honest empty state with a clear-all action, not an invented playbook.
4. Set `deliverables`, `icon`, and `defaultFrequency`. The existing icons are `radar`, `pen`, `briefcase`, `shield`, and `clock`; an unknown name uses `radar`. The default frequency must occur in the catalog’s `frequencies` choices. Use `null` for an on demand playbook: the form then skips the frequency question and the prompt must not contain `{frequency}`.
5. Define additional text `questions`, each with a `key` that starts with a lowercase letter and contains only letters (for example `goal` or `hoursPerDay`), visible `label`, example `placeholder`, `hint`, and integer `maxLength` from 1 to 500. The three standard keys are `experience`, `frequency`, and `channel`; do not duplicate them. Channel is always asked. Experience is asked only when the prompt contains `{experience}`, and frequency only when `defaultFrequency` is set.
6. Write a `prompt` with `{experience}`, `{frequency}`, `{channel}`, and the question keys as placeholders. Every question must have a matching placeholder, and every placeholder must have a question. Repeated placeholders are allowed. Substitution is literal and single-pass; answers cannot execute HTML or recursively expand other placeholders.
7. Set `schedule` and `guardrails`. Use `checklistSeparator: ", "` only if commas separate distinct checklist items, otherwise `null` for a single item. Copying always preserves the original guardrails string, including punctuation.
8. Set `riskWarning` to an appropriate plain warning ending in `Not financial advice.` when an additional financial warning is needed. Warnings are displayed and appended, after a blank line, to **each** copied block. Use `null` for unrelated topics or an exact supplied prompt that already contains its required safety ending. The five playbooks in this update use `null` so their copied prompts stay exactly as requested; the first four include the full shared safety line, and the thread writer keeps its own ending.
9. Optionally add `author` and/or `tipAddress` using the creator fields described below. Leave them out until the creator supplies the values; do not insert examples or recipient stand-ins.
10. Run the typecheck, build, tests, and interaction validation. The new card, form, output, and static metadata page are generated automatically. Every playbook in the catalog appears under Live on the roadmap automatically. Planned items (Next, Later, Exploring) and the roadmap disclaimer live in [`src/data/roadmap.json`](src/data/roadmap.json).

The original three prompt texts, schedules, and guardrails are preserved verbatim, alongside the requested perps funding digest. Unit fixtures lock their content. When adding another playbook, update the test’s catalog count and add appropriate tests without changing existing content fixtures. UI descriptions and help text are separate from those fixed templates.

The chosen frequency fills `{frequency}`. The supplied recommended schedule stays verbatim. If they differ, the output explicitly asks the user to reconcile the cadence in Grok Bot; the recommendation is not silently rewritten.

### Creator fields

The playbook schema is defined by `Playbook` in [`src/types.d.ts`](src/types.d.ts) and enforced at build time by [`scripts/catalog.mjs`](scripts/catalog.mjs).

| Optional field | Format | Display |
| --- | --- | --- |
| `author` | Nonempty plain-text string | `By {author}` on the card, configuration summary and generated output |
| `tipAddress` | Nonempty plain-text recipient address supplied by the creator | Full selectable address, **Copy address** button and the exact notice below on those surfaces |

Both fields are independent. Omit absent fields; empty strings, `null`, non-string values, surrounding whitespace, control characters and bidirectional override characters fail catalog validation. Values are escaped as text and long values wrap without truncation. The site copies the address as supplied; it does not infer or verify a chain, verify ownership, open a wallet or initiate a payment. Confirm the address and chain with the creator before sending anything yourself.

> Tip the creator. Send only on the right chain. Nuntio does not hold or process payments.

Creator copy buttons are siblings of the main card link, so copying does not navigate. Clipboard denial offers a focused manual-copy textarea. All production entries currently omit both fields. The focused validation compiles isolated test-only metadata without changing the production catalog or export.

## Add another assistant

Add an object to `agents` in the same JSON file, with a unique `id`, `name`, verified documentation URLs, `verifiedAt`, `channels`, `setupSteps`, and `capabilities`. Point a new playbook’s `agentId` at it. Forms and the output handoff use that assistant’s configuration. The generator and URL model do not import an assistant SDK or require a provider-specific backend. `defaultAgentId` selects the assistant described in the general guide. The current home prompt and branded social artwork deliberately use the requested Grok Bot wording.

## What was verified about Grok Bot

Official xAI documentation was checked on **2026-10-29**. The UI links to those sources rather than promising an integration:

- Bot creation and setup in a conversation: [Get started](https://docs.x.ai/grok-bot/get-started).
- Scheduled routines, testing, and time-zone confirmation: [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations).
- Public X research, connected apps, Slack permissions, and email limits: [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps).

Grok Bot chat is the default delivery choice. Email and Slack are requests to configure inside Grok Bot, not connections made by nuntio. In particular, emails from the Bot’s own address during a routine wait as drafts for a person to send. Availability, account access, app permissions, and usage limits can change. The generated instructions are not a technical enforcement boundary.

## Deliberately left out

Static hosting provides no assistant execution, live X or web search, email/Slack delivery, schedule creation, background jobs, account authentication, shared database, cloud saves, private links, URL shortening, or dynamic social cards containing answers. nuntio can generate a prompt after its page has loaded offline, but it does not install an offline cache or service worker for uncached page loads.

Wallet connections, signing, trade execution, custody, automated posts/replies, job applications, and unsolicited outreach are excluded by product scope, independently of hosting. Nothing in the site suggests those actions have been performed. Copying works through the Clipboard API, then a native selection fallback; if both are denied, a focused textarea allows manual copying.

Publication is handled by the contributor platform after submission, under the requested **nuntio** label. No publishing command was run and no new hostname is invented. Social unfurling on the eventual gateway was not tested; some crawlers may require an absolute image URL after a stable address is known.

No requested revision feature was left out. The existing playbooks, all three setup guides with both modes, Scan and roadmap are retained. Roadmap groups list the requested live, next and exploring items without release dates or promises about a token launch.

## Validation

To run the browser checks with the external tooling above:

```sh
export PLAYWRIGHT_BROWSERS_PATH=/tmp/nuntio-browsers
playwright install chromium webkit
npm run validate
node scripts/validate-revision.mjs
node scripts/validate-solana-authorities.mjs
node scripts/validate-update.mjs
node scripts/review.mjs
```

The validation command manages its own temporary static server under an IPFS-like subpath, runs the real production export, and writes disposable evidence to `test/scratch/validation/`. It closes the server and browser when finished. WebKit launch failures are reported as limitations, not passing tests. To regenerate the social image after editing its SVG, run `node scripts/social.mjs`, then rebuild.

Current playbook/profile update (30 Oct 2026): production build and strict typecheck pass; **86 unit tests**, **23 main interaction groups**, **8 prior-revision groups**, **7 update-specific groups** and **16/16 pinned design-probe checks** pass. The main, prior-revision and update browser suites report **36 axe scans with zero violations**. The first home action ends at 500.56px on a 390 × 844 screen. See [`docs/update-validation.md`](docs/update-validation.md) for exact commands, six-domain coverage, fixes, screenshots and limitations. No requested feature is left out. The assigned browser tool could not launch because Chrome was unavailable; local Playwright Chromium completed the checks. WebKit could not launch because host libraries are missing. RPC replies in interaction validation are intercepted fixtures.

Previous authority revision (30 Oct 2026): malformed Solana mint/freeze fields now fail the read instead of becoming “None.” Only explicit `null` or a valid 32-byte base58 address is accepted. One distinct fallback retries the complete read; if it also fails, no facts or research prompts are shown. That revision passed 78 unit tests and 24 focused browser scenarios; its historical evidence is in [`docs/solana-authority-validation.md`](docs/solana-authority-validation.md). These authority checks remain in the unit suite.

Results retained from the previous revision (29 Oct 2026):

| Check | Result |
| --- | --- |
| `npm run build` | Passed; home + 4 static playbook pages + 3 static setup guides and 4 local assets; CSP includes each chain's primary and fallback |
| `npm run typecheck` | Passed; strict TypeScript checking of the JavaScript and data types |
| `npm test` | 55 passed, 0 failed, including malformed RPC/ABI replies, full fallback retries, catalog validation, program balances and unchanged prompt fixtures |
| `npm run validate` | 18 Chromium flow groups passed; 86 reflow measurements; no captured errors, failed static assets or unexpected requests; RPC scenarios intercepted |
| `node scripts/validate-revision.mjs` | 8 Chromium flow groups passed; 7 reflow measurements; malformed-field fallback/error matrix, pending/completed result invalidation, Robinhood fallback, program profile/save/reload, privacy and branding |
| Automated accessibility | 23 axe scans across both browser scripts, 0 reported violations |
| Responsive reflow | 320, 390, 768, 1024, 1440 widths; 200% text sizing on home, every form/output and both modes of every setup guide |
| `node scripts/review.mjs` | Guide copy actions fit the 390 × 844 first screen; measured guide contrast and roadmap reflow pass |
| Pinned `taste@1` | 16/16 passed, including the 390-wide first screen |
| WebKit | Unperformed: browser launch reported missing host libraries |

The pinned probe was run as:

```sh
IMD_PLAYWRIGHT=/tmp/nuntio-tools/node_modules/playwright/index.mjs \
  node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline
```

The `.imd/reads/` inputs are removed before delivery; this update's recorded probe results remain in [`docs/update-taste-checks.json`](docs/update-taste-checks.json). The probe passes 16/16 checks. [`docs/taste-checks.json`](docs/taste-checks.json) retains the earlier revision's evidence. Source-based tests and browser-validation scripts remain reproducible without the pinned inputs. `node scripts/check-export.mjs` checks the complete deliverable against the **8 MiB** budget and rejects dependency/cache directories and archives at every nesting level; it excludes disposable `test/scratch/` output.

See [`docs/update-validation.md`](docs/update-validation.md) for the current six-domain review and [`docs/validation.md`](docs/validation.md) for earlier revisions. [`DESIGN.md`](DESIGN.md) describes the implemented design system. These are worker-run checks, not independent certification. No screen-reader session, physical-device test, native browser zoom, live assistant execution, or live X crawler test was performed.
