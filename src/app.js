import rawCatalog from './data/playbooks.json';
import rawGuides from './data/guides.json';
import rawChains from './data/chains.json';
import rawRoadmap from './data/roadmap.json';
import { createGuidePrompt, guideDate } from './guide-model.js';
import { createScanView } from './scan-view.js';
import { createLaunchesView } from './launches-view.js';
import { agentFor, answerHash, standardFields, createOutputs, defaultsFor, escapeHTML as esc, fillTemplate, matchPlaybooks, parseRoute, readAnswers, validateAnswers } from './model.js';

/** @typedef {import('./types').Playbook} Playbook */
/** @typedef {import('./types').Answers} Answers */
/** @typedef {import('./types').Choice} Choice */
/** @type {import('./types').Catalog} */
const catalog = rawCatalog;
/** @type {import('./types').GuideCatalog} */
const guideCatalog = rawGuides;
/** @type {import('./types').Roadmap} */
const roadmap = rawRoadmap;
const root = document.body.dataset.root || './';
const pageId = document.body.dataset.playbook || '';
const guideId = document.body.dataset.guide || '';
const app = /** @type {HTMLElement} */ (document.querySelector('#app'));
const status = /** @type {HTMLElement} */ (document.querySelector('#status'));
const defaultAgent = catalog.agents.find(({ id }) => id === catalog.defaultAgentId) || catalog.agents[0];
let firstRender = true;
let searchQuery = '';
let announcementTimer = 0;
/** @type {WeakMap<HTMLButtonElement, {original: string, timer: number}>} */
const copyFeedback = new WeakMap();

/** @param {string} name @param {string} [className] */
function icon(name, className = '') {
  /** @type {Record<string, string>} */
  const paths = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    external: '<path d="M7 17 17 7M7 7h10v10"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7"/><circle cx="12" cy="12" r="1"/>',
    pen: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5M4 15l5 5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a20 20 0 0 0 18 0M10 12h4v4h-4z"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/>',
  };
  return `<svg class="icon ${className}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.radar}</svg>`;
}

/** @param {string} text */
function announce(text) {
  window.clearTimeout(announcementTimer);
  status.textContent = '';
  announcementTimer = window.setTimeout(() => { status.textContent = text; }, 50);
}

/** @param {string} path */
function homeHref(path = '/') { return pageId || guideId ? `${root}index.html#${path}` : `#${path}`; }

/** @param {Playbook} playbook */
function playbookHref(playbook) { return `${root}playbooks/${playbook.id}/index.html#/configure`; }

/** @param {import('./types').SetupGuide} guide */
function guideHref(guide) { return `${root}guides/${guide.id}/index.html`; }

function shell() {
  const header = /** @type {HTMLElement} */ (document.querySelector('#site-header'));
  header.innerHTML = `<div class="header-inner wrap">
    <a class="brand" href="${homeHref()}" aria-label="nuntio home"><svg width="31" height="31" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 26V6h4l14 20h4V6h-5v13L13 6H5" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg><span>nuntio</span></a>
    <nav aria-label="Main navigation"><a class="nav-link" href="${homeHref('/guide')}">How it works</a><a class="nav-link docs-link" href="${esc(defaultAgent.docsUrl)}" target="_blank" rel="noopener noreferrer">${esc(defaultAgent.name)} docs ${icon('external')}<span class="sr-only"> (opens in new tab)</span></a></nav>
  </div><nav class="site-tabs wrap" aria-label="nuntio sections"><a href="${homeHref()}" data-section="playbooks">Playbooks</a><a href="${homeHref('/scan')}" data-section="scan">Scan</a><a href="${homeHref('/launches')}" data-section="launches">Launches</a><a href="${homeHref('/guides')}" data-section="guides">Setup guides</a><a href="${homeHref('/roadmap')}" data-section="roadmap">Roadmap</a></nav>`;
  const footer = /** @type {HTMLElement} */ (document.querySelector('#site-footer'));
  footer.innerHTML = `<div class="footer-inner wrap"><p>Research and instructions only. nuntio never trades, connects a wallet or signs anything. Not financial advice.</p><div><span>Independent of xAI</span><a href="${homeHref('/guide')}">About & privacy</a></div></div>`;
}

function safetyBanner() {
  return `<aside class="safety-banner" aria-label="Setup safety">${icon('shield')}<p>${esc(guideCatalog.banner)}</p></aside>`;
}

/** @param {import('./types').SetupGuide} guide */
function sourceLinks(guide) {
  return `<div class="guide-source-links"><a href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ${icon('external')}<span class="sr-only"> for ${esc(guide.title)} (opens in new tab)</span></a><a href="${esc(guideCatalog.reportUrl)}" target="_blank" rel="noopener noreferrer">Report a broken step<span class="sr-only"> for ${esc(guide.title)} (opens in new tab)</span></a></div>`;
}

function renderGuides() {
  document.title = 'Wallet setup guides | nuntio';
  app.innerHTML = `<div class="wrap setup-library"><div class="setup-library-heading"><h1 id="page-title" tabindex="-1">Connect your agent.</h1><p>Wallet setup guides to follow with your agent, one approved step at a time.</p></div>
    ${safetyBanner()}
    <div class="setup-grid">${guideCatalog.guides.map((guide) => `<article class="setup-card"><a class="guide-card-link" href="${guideHref(guide)}" aria-labelledby="setup-title-${esc(guide.id)}"><div class="setup-card-top">${icon('shield')}${guide.risk ? `<span class="risk-label">Risk: ${esc(guide.risk)}</span>` : '<span>App approval</span>'}</div><h2 id="setup-title-${esc(guide.id)}">${esc(guide.title)}</h2><p>${esc(guide.description)}</p><p class="guide-card-note">${esc(guide.note)}</p><span class="card-cta">Open guide ${icon('arrow')}</span></a><div class="guide-card-meta"><p>Last verified <time datetime="${esc(guide.verifiedAt)}">${esc(guideDate(guide.verifiedAt))}</time></p>${sourceLinks(guide)}</div></article>`).join('')}</div>
    <p class="setup-footnote">nuntio provides instructions only. Setup happens with your own agent and the provider. No wallet connects to this site.</p></div>`;
}

/** @param {import('./types').SetupGuide} guide */
function renderSetupGuide(guide) {
  document.title = `${guide.title} setup | nuntio`;
  const prompt = createGuidePrompt(guideCatalog.promptTemplate, guide.prompt);
  app.innerHTML = `<div class="wrap setup-detail"><a class="back-link" href="${homeHref('/guides')}">${icon('back')} All setup guides</a>
    <div class="setup-page-heading"><h1 id="page-title" tabindex="-1">${esc(guide.title)}</h1><div class="guide-meta"><span>Last verified <time datetime="${esc(guide.verifiedAt)}">${esc(guideDate(guide.verifiedAt))}</time></span>${guide.risk ? `<span class="risk-label">Risk: ${esc(guide.risk)}</span>` : ''}</div><p class="setup-note">${esc(guide.note)}</p></div>
    ${safetyBanner()}
    <fieldset class="mode-control"><legend class="sr-only">Choose how to follow this guide</legend><div class="segmented guide-mode"><label><input type="radio" name="guide-mode" value="agent" checked aria-controls="agent-panel"><span>Let your agent do it</span></label><label><input type="radio" name="guide-mode" value="self" aria-controls="self-panel"><span>Do it yourself</span></label></div></fieldset>
    <div class="setup-layout"><div class="setup-main"><section class="before-start" aria-labelledby="before-heading"><h2 id="before-heading">Before you start</h2><ul>${guide.beforeYouStart.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></section>
    <section id="agent-panel" aria-labelledby="agent-heading"><div class="block-heading"><h2 id="agent-heading">One prompt. Every setup step.</h2><button class="button primary" type="button" id="copy-agent-prompt">${icon('copy')} Copy agent prompt</button></div><p class="block-instruction">Copy this into your own agent session. Read its replies and approve each action.</p><div class="agent-prompt prompt-text" id="agent-prompt">${esc(prompt)}</div></section>
    <section id="self-panel" aria-labelledby="self-heading" hidden><div class="checklist-heading"><h2 id="self-heading">Follow the steps</h2><p class="small muted" id="setup-progress" role="status">0 of ${guide.steps.length} steps checked</p></div><p class="block-instruction">Check each step after you review it. Checks stay on this page until you leave.</p><ol class="setup-steps">${guide.steps.map((step, index) => `<li><label for="setup-step-${index}"><input type="checkbox" id="setup-step-${index}" data-setup-step><span class="setup-step-content"><strong class="step-actor">${step.actor === 'you' ? 'You do this' : 'Your agent does this'}</strong><span>${esc(step.text)}</span>${step.commands.map((command) => `<code>${esc(command)}</code>`).join('')}</span></label></li>`).join('')}</ol></section>
    <div class="manual-copy" id="copy-fallback" hidden><p>Automatic copying is unavailable. Select the text below and copy it manually.</p><label for="manual-copy">Text to copy</label><textarea id="manual-copy" rows="10" readonly></textarea></div></div>
    <aside class="setup-safety" aria-labelledby="safe-heading"><h2 id="safe-heading">Stay safe</h2><ul>${[...guide.staySafe, ...guideCatalog.safetyRules].map((rule) => `<li>${esc(rule)}</li>`).join('')}</ul>${sourceLinks(guide)}<p class="small muted">This site never runs a command, signs you in, holds funds or executes trades. Not financial advice.</p></aside></div></div>`;
  document.querySelector('#copy-agent-prompt')?.addEventListener('click', (event) => {
    void copy(prompt, /** @type {HTMLButtonElement} */ (event.currentTarget), `${guide.title} agent prompt copied.`);
  });
  document.querySelectorAll('input[name="guide-mode"]').forEach((radio) => radio.addEventListener('change', (event) => {
    const agentMode = /** @type {HTMLInputElement} */ (event.currentTarget).value === 'agent';
    /** @type {HTMLElement} */ (document.querySelector('#agent-panel')).hidden = !agentMode;
    /** @type {HTMLElement} */ (document.querySelector('#self-panel')).hidden = agentMode;
    /** @type {HTMLElement} */ (document.querySelector('#copy-fallback')).hidden = true;
    announce(agentMode ? 'Agent prompt shown.' : 'Numbered setup checklist shown.');
  }));
  document.querySelectorAll('[data-setup-step]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    const count = document.querySelectorAll('[data-setup-step]:checked').length;
    /** @type {HTMLElement} */ (document.querySelector('#setup-progress')).textContent = `${count} of ${guide.steps.length} steps checked`;
  }));
}

/** @param {string} title @param {string} text @param {string} [href] @param {string} [linkText] @param {string} [mark] */
function roadmapItem(title, text, href = '', linkText = '', mark = 'check') {
  return `<li>${icon(mark)}<div><h3>${esc(title)}</h3><p>${esc(text)}</p>${href ? `<a href="${href}">${esc(linkText)} ${icon('arrow')}</a>` : ''}</div></li>`;
}

/** @param {string[]} names */
function listNames(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** Live is built from what exists in the catalogs, so it can only list real features.
 * Next, Later and Exploring come from src/data/roadmap.json. */
function renderRoadmap() {
  document.title = 'Roadmap | nuntio';
  const chains = listNames(rawChains.chains.map(({ label }) => label));
  const providers = listNames(guideCatalog.guides.map(({ title }) => title.replace(/ Agentic Wallet$/, '')));
  const live = [
    roadmapItem('Scan tab', `Read a token or wallet on ${chains}, then copy a research prompt.`, homeHref('/scan'), 'Scan an address'),
    roadmapItem('Setup guides', `Set up a ${providers} agentic wallet with your agent, one approved step at a time.`, homeHref('/guides'), 'Browse setup guides'),
    ...catalog.playbooks.map((playbook) => roadmapItem(playbook.title, playbook.description, playbookHref(playbook), `Build ${playbook.title.split(' ').map((word) => (word.length === 1 ? word : word.toLowerCase())).join(' ')}`)),
  ].join('');
  const planned = roadmap.groups.map((group) => `<section aria-labelledby="${esc(group.id)}-heading"><h2 id="${esc(group.id)}-heading">${esc(group.title)}</h2><ul class="roadmap-list roadmap-plain">${group.items.map((item) => roadmapItem(item.title, item.text, '', '', group.icon)).join('')}</ul></section>`).join('');
  app.innerHTML = `<div class="wrap roadmap"><h1 id="page-title" tabindex="-1">A clearer next step.</h1><p class="guide-intro">What is live in nuntio, what comes next, and what we are still exploring.</p>
    <section aria-labelledby="live-heading"><h2 id="live-heading">Live</h2><ul class="roadmap-list">${live}</ul></section>
    ${planned}
    <p class="small muted roadmap-disclaimer">${esc(roadmap.disclaimer)}</p>
    <a class="back-link" href="${esc(guideCatalog.reportUrl)}" target="_blank" rel="noopener noreferrer">Report a broken step ${icon('external')}<span class="sr-only"> (opens in new tab)</span></a></div>`;
}

/** Optional attribution is plain text; the address is copied, never used as a payment link.
 * @param {Playbook} playbook */
function creatorInfo(playbook) {
  if (!playbook.author && !playbook.tipAddress) return '';
  return `<div class="creator-info">${playbook.author ? `<p class="creator-author">By <bdi>${esc(playbook.author)}</bdi></p>` : ''}${playbook.tipAddress ? `<code class="tip-address" dir="ltr">${esc(playbook.tipAddress)}</code><button class="button secondary copy-button" type="button" data-copy-tip="${esc(playbook.id)}" aria-label="Copy tip address for ${esc(playbook.title)}" aria-describedby="tip-note-${esc(playbook.id)}">${icon('copy')} Copy address</button><p class="tip-note" id="tip-note-${esc(playbook.id)}">Tip the creator. Send only on the right chain. Nuntio does not hold or process payments.</p>` : ''}</div>`;
}

function bindCreatorCopy() {
  document.querySelectorAll('[data-copy-tip]').forEach((element) => element.addEventListener('click', () => {
    const button = /** @type {HTMLButtonElement} */ (element);
    const playbook = catalog.playbooks.find(({ id }) => id === button.dataset.copyTip);
    if (playbook?.tipAddress) void copy(playbook.tipAddress, button, 'Creator tip address copied. Send only on the right chain.');
  }));
}

/** @param {Playbook} playbook @param {number} index @param {boolean} matched */
function card(playbook, index, matched) {
  return `<article class="playbook-card"><a class="playbook-card-link" href="${playbookHref(playbook)}" aria-labelledby="card-title-${esc(playbook.id)}">
    <div class="card-top">${icon(playbook.icon, 'card-icon')}<span>${esc(playbook.category)}</span></div>
    <h3 id="card-title-${esc(playbook.id)}">${esc(playbook.title)}</h3>
    <p>${esc(playbook.description)}</p>
    <div class="card-bottom"><span>${matched ? `Match ${index + 1}` : `${playbook.questions.length + 3} questions`}</span><span class="card-cta">Build playbook ${icon('arrow')}</span></div>
  </a>${creatorInfo(playbook)}</article>`;
}

function renderHome() {
  document.title = 'nuntio — Tell your bot what to do.';
  app.innerHTML = `<div class="wrap home">
    <section class="hero" aria-labelledby="page-title">
      <div><h1 id="page-title" tabindex="-1">Tell your bot<br> <span>what to do.</span></h1><p class="hero-description">A starting point for ${esc(defaultAgent.name)}.<br> Choose a goal. Get a playbook.</p></div>
      <ol class="hero-steps" aria-label="How nuntio works"><li><span>01</span><div>Pick a direction<small>Research, create, or find work</small></div></li><li><span>02</span><div>Make it yours<small>A few questions, in plain language</small></div></li><li><span>03</span><div>Give your bot a job<small>Copy your prompt and get started</small></div></li></ol>
    </section>
    <section class="goal-section" aria-label="Find a playbook">
      <form id="goal-form" role="search"><label for="goal">What do you want Grok Bot to do for you?</label><div class="goal-controls"><div class="goal-input">${icon('search')}<input id="goal" name="goal" type="search" placeholder="e.g. Find remote design jobs" maxlength="240" autocomplete="off" value="${esc(searchQuery)}" aria-describedby="search-hint"></div><button class="button primary" type="submit">Find a playbook ${icon('arrow')}</button></div></form>
      <div class="search-examples"><span id="search-hint">Try a goal:</span><button type="button" data-example="Research meme coins">Research coins</button><button type="button" data-example="Write posts">Write posts</button><button type="button" data-example="Find a job">Find a job</button></div>
    </section>
    <section class="library" aria-labelledby="results-heading"><div class="section-heading"><h2 id="results-heading" tabindex="-1">Choose a playbook</h2><span id="results-count" class="count">${catalog.playbooks.length} ways to start</span></div><div id="search-empty"></div><div id="playbook-grid" class="playbook-grid"></div><div id="copy-fallback" class="manual-copy" hidden><label for="manual-copy">Copy manually</label><p>Automatic copying is unavailable in this browser. Select and copy the text below.</p><textarea id="manual-copy" rows="6" readonly></textarea></div><p class="library-note">${icon('shield')} You set the goal. You stay in control.</p></section>
    <div class="home-note"><span>Built in your browser.</span><p>No account needed here. Take your playbook to ${esc(defaultAgent.name)} when you’re ready.</p><a href="${homeHref('/guide')}">See how it works ${icon('arrow')}</a></div>
  </div>`;
  const field = /** @type {HTMLInputElement} */ (document.querySelector('#goal'));
  function updateResults() {
    searchQuery = field.value;
    const matches = matchPlaybooks(searchQuery, catalog.playbooks);
    const searching = Boolean(searchQuery.trim());
    const heading = /** @type {HTMLElement} */ (document.querySelector('#results-heading'));
    const count = /** @type {HTMLElement} */ (document.querySelector('#results-count'));
    const grid = /** @type {HTMLElement} */ (document.querySelector('#playbook-grid'));
    const empty = /** @type {HTMLElement} */ (document.querySelector('#search-empty'));
    heading.textContent = searching ? (matches.length ? 'Top matches' : 'No matching playbook yet') : 'Choose a playbook';
    count.textContent = searching ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : `${catalog.playbooks.length} ways to start`;
    empty.innerHTML = searching && !matches.length ? `<div class="empty-state"><p>Try words like “jobs”, “posts”, or “coins”, or explore all playbooks.</p><button class="button secondary" type="button" id="clear-search">Show all playbooks</button></div>` : '';
    grid.innerHTML = matches.map(({ playbook }, index) => card(playbook, index, searching)).join('');
    bindCreatorCopy();
    document.querySelector('#clear-search')?.addEventListener('click', () => { field.value = ''; updateResults(); field.focus(); });
    announce(searching ? `${count.textContent}. ${heading.textContent}.` : `${catalog.playbooks.length} playbooks available.`);
  }
  field.addEventListener('input', updateResults);
  document.querySelector('#goal-form')?.addEventListener('submit', (event) => { event.preventDefault(); updateResults(); document.querySelector('#results-heading')?.scrollIntoView({ block: 'nearest' }); /** @type {HTMLElement} */ (document.querySelector('#results-heading')).focus({ preventScroll: true }); });
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => { field.value = /** @type {HTMLElement} */ (button).dataset.example || ''; updateResults(); }));
  updateResults();
}

/** @param {Playbook} playbook @param {number} step */
function pageHeading(playbook, step) {
  return `<div class="page-topline"><a class="back-link" href="${homeHref()}">${icon('back')} All playbooks</a><span class="step-label">Step ${step} of 2 <span class="step-dots" aria-hidden="true"><i class="active"></i><i class="${step === 2 ? 'active' : ''}"></i></span></span></div>
    <div class="page-heading"><div class="heading-icon">${icon(playbook.icon)}</div><h1 id="page-title" tabindex="-1">${esc(playbook.title)}</h1><p>${step === 1 ? 'A few details. A clear job for your bot.' : 'Your setup is ready to copy.'}</p></div>`;
}

/** @param {Playbook} playbook */
function summary(playbook) {
  return `<aside class="playbook-summary" aria-label="About this playbook"><h2>What you’ll get</h2><ul class="deliverables">${playbook.deliverables.map((item) => `<li>${icon('check')}<span>${esc(item)}</span></li>`).join('')}</ul><div class="summary-schedule">${icon('clock')}<div><h3>Suggested schedule</h3><p>${esc(playbook.schedule)}</p></div></div><p class="small muted">You’ll review the results before taking action.</p>${playbook.riskWarning ? `<p class="risk-note">${icon('warning')}<span>${esc(playbook.riskWarning)}</span></p>` : ''}${creatorInfo(playbook)}</aside>`;
}

/** @param {string} key @param {string} label @param {Choice[]} choices @param {string} selected @param {string} [hint] */
function selectField(key, label, choices, selected, hint = '') {
  return `<div class="field"><label for="${key}">${label}</label><select id="${key}" name="${key}"${hint ? ` aria-describedby="${key}-hint"` : ''}>${choices.map(({ value, label: optionLabel }) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(optionLabel)}</option>`).join('')}</select>${hint ? `<p class="field-hint" id="${key}-hint">${esc(hint)}</p>` : ''}</div>`;
}

/** @param {Playbook} playbook @param {Answers} answers @param {boolean} repaired */
function renderConfigure(playbook, answers, repaired) {
  const agent = agentFor(playbook, catalog);
  const channel = agent.channels.find(({ value }) => value === answers.channel) || agent.channels[0];
  const asks = standardFields(playbook);
  document.title = `${playbook.title} | nuntio`;
  app.innerHTML = `<div class="wrap detail">${pageHeading(playbook, 1)}${repaired ? '<p class="state-notice" role="alert">Some saved answers could not be read. Review your answers before generating.</p>' : ''}<div class="builder-layout"><form id="playbook-form" novalidate>
    <fieldset><legend>The basics</legend>${asks.includes('experience') ? `<fieldset class="experience-field"><legend>Your experience level</legend><div class="segmented">${catalog.experiences.map(({ value, label }) => `<label><input type="radio" name="experience" value="${esc(value)}" ${answers.experience === value ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div></fieldset>` : ''}<div class="field-row">${asks.includes('frequency') ? selectField('frequency', 'How often should it update you?', catalog.frequencies, answers.frequency) : ''}${selectField('channel', 'Where should it send updates?', agent.channels, answers.channel)}</div><p class="field-hint channel-hint" id="channel-hint">${esc(channel.hint || '')} <a href="${esc(agent.appsUrl)}" target="_blank" rel="noopener noreferrer">Check delivery requirements<span class="sr-only"> (opens in new tab)</span></a></p></fieldset>
    <fieldset><legend>Make it yours</legend>${playbook.questions.map((question) => `<div class="field"><label for="${question.key}">${esc(question.label)}</label><input type="text" id="${question.key}" name="${question.key}" value="${esc(answers[question.key])}" placeholder="${esc(question.placeholder)}" required maxlength="${question.maxLength}" aria-describedby="${question.key}-hint ${question.key}-error" autocomplete="off"><p class="field-hint" id="${question.key}-hint">${esc(question.hint)}</p><p class="field-error" id="${question.key}-error" hidden></p></div>`).join('')}</fieldset>
    <p class="privacy-note">Your answers stay in this link. Anyone you share it with can read them. Keep personal details and secrets out.</p><div class="form-actions"><button class="button primary" type="submit">Generate playbook ${icon('arrow')}</button><button class="button text-button" type="button" id="reset-answers">Reset answers</button></div>
    <div id="copy-fallback" class="manual-copy" hidden><label for="manual-copy">Copy manually</label><p>Automatic copying is unavailable in this browser. Select and copy the text below.</p><textarea id="manual-copy" rows="6" readonly></textarea></div>
  </form>${summary(playbook)}</div></div>`;
  bindCreatorCopy();
  const form = /** @type {HTMLFormElement} */ (document.querySelector('#playbook-form'));
  document.querySelector('#channel')?.setAttribute('aria-describedby', 'channel-hint');
  /** @returns {Answers} */
  function currentAnswers() { return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)])); }
  function persist() { history.replaceState(null, '', answerHash('/configure', currentAnswers())); }
  function updateForm() {
    persist();
    const selected = agent.channels.find(({ value }) => value === currentAnswers().channel) || agent.channels[0];
    const hint = /** @type {HTMLElement} */ (document.querySelector('#channel-hint'));
    hint.innerHTML = `${esc(selected.hint || '')} <a href="${esc(agent.appsUrl)}" target="_blank" rel="noopener noreferrer">Check delivery requirements<span class="sr-only"> (opens in new tab)</span></a>`;
  }
  form.addEventListener('input', (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (target.id && target.value.trim()) {
      target.removeAttribute('aria-invalid');
      const error = document.getElementById(`${target.id}-error`);
      if (error) { error.hidden = true; error.textContent = ''; }
    }
    updateForm();
  });
  form.addEventListener('change', updateForm);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = currentAnswers();
    const errors = validateAnswers(playbook, current);
    for (const { key } of playbook.questions) {
      const input = /** @type {HTMLInputElement} */ (document.getElementById(key));
      const error = /** @type {HTMLElement} */ (document.getElementById(`${key}-error`));
      input.setAttribute('aria-invalid', String(Boolean(errors[key])));
      error.textContent = errors[key] || '';
      error.hidden = !errors[key];
    }
    const firstError = Object.keys(errors)[0];
    if (firstError) { document.getElementById(firstError)?.focus(); announce('Add the missing answers to generate your playbook.'); return; }
    location.hash = answerHash('/output', current);
  });
  document.querySelector('#reset-answers')?.addEventListener('click', () => {
    history.replaceState(null, '', answerHash('/configure', defaultsFor(playbook, catalog)));
    renderConfigure(playbook, defaultsFor(playbook, catalog), false);
    /** @type {HTMLElement} */ (document.querySelector('#playbook-form input, #playbook-form select')).focus();
    announce('Answers reset.');
  });
  persist();
}

/** @param {string} text @param {HTMLButtonElement} button @param {string} message */
async function copy(text, button, message) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; }
  } catch { /* A restricted gateway can deny clipboard access. Try the native selection fallback. */ }
  if (!copied) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('aria-label', 'Text to copy');
    field.className = 'clipboard-helper';
    document.body.append(field);
    field.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    field.remove();
    button.focus({ preventScroll: true });
  }
  if (copied) {
    const previous = copyFeedback.get(button);
    if (previous) window.clearTimeout(previous.timer);
    const original = previous?.original || button.innerHTML;
    button.innerHTML = `${icon('check')} Copied`;
    announce(message);
    const timer = window.setTimeout(() => { if (button.isConnected) button.innerHTML = original; copyFeedback.delete(button); }, 1800);
    copyFeedback.set(button, { original, timer });
  } else {
    const fallback = /** @type {HTMLElement} */ (document.querySelector('#copy-fallback'));
    fallback.hidden = false;
    const field = /** @type {HTMLTextAreaElement} */ (fallback.querySelector('textarea'));
    field.value = text;
    field.focus();
    field.select();
    announce('Automatic copying is unavailable. Copy the selected text in the manual copy field.');
  }
}

/** @param {Playbook} playbook @param {Answers} answers */
function renderOutput(playbook, answers) {
  const agent = agentFor(playbook, catalog);
  const output = createOutputs(playbook, answers);
  const channel = agent.channels.find(({ value }) => value === answers.channel) || agent.channels[0];
  const checklist = playbook.checklistSeparator ? playbook.guardrails.split(playbook.checklistSeparator) : [playbook.guardrails];
  const risk = playbook.riskWarning ? `<p class="risk-note output-risk">${icon('warning')}<span>${esc(playbook.riskWarning)}</span></p>` : '';
  document.title = `${playbook.title} | nuntio`;
  app.innerHTML = `<div class="wrap detail output-page">${pageHeading(playbook, 2)}<div class="output-actions"><a class="button secondary" href="${answerHash('/configure', answers)}">${icon('back')} Edit answers</a><button class="button secondary" id="share-link" type="button">${icon('link')} Copy share link</button><p class="small muted">The link includes your answers.</p></div>
    ${creatorInfo(playbook)}<div class="output-layout"><div class="output-blocks">
      <section class="output-block" aria-labelledby="prompt-heading"><div class="block-heading"><h2 id="prompt-heading"><span class="block-number">01</span> Setup prompt</h2><button class="button copy-button" type="button" data-copy="prompt" aria-label="Copy setup prompt">${icon('copy')} Copy</button></div><p class="block-instruction">Paste this into your ${esc(agent.name)} conversation.</p><div class="prompt-text" id="prompt-text">${esc(fillTemplate(playbook.prompt, answers))}</div>${risk}</section>
      <section class="output-block" aria-labelledby="schedule-heading"><div class="block-heading"><h2 id="schedule-heading"><span class="block-number">02</span> Recommended schedule</h2><button class="button copy-button" type="button" data-copy="schedule" aria-label="Copy recommended schedule">${icon('copy')} Copy</button></div><p class="schedule-text" id="schedule-text">${esc(playbook.schedule)}</p>${risk}<p class="block-instruction schedule-context">${playbook.defaultFrequency === null ? `Run this whenever you need it. There is nothing to schedule in ${esc(agent.name)}.` : `Your prompt requests updates every ${esc(answers.frequency)}. ${answers.frequency !== playbook.defaultFrequency ? 'This differs from the recommendation above. ' : ''}Confirm the final cadence, exact time, and time zone in ${esc(agent.name)}.`}</p></section>
      <section class="output-block" aria-labelledby="guardrails-heading"><div class="block-heading"><h2 id="guardrails-heading"><span class="block-number">03</span> Guardrails checklist</h2><button class="button copy-button" type="button" data-copy="guardrails" aria-label="Copy guardrails checklist">${icon('copy')} Copy</button></div><ul class="guardrails">${checklist.map((item, index) => `<li><label><input type="checkbox" name="review-${index}"><span>${esc(item)}</span></label></li>`).join('')}</ul>${risk}<p class="block-instruction">Check these as you review. Your checks stay on this screen.</p></section>
      <div id="copy-fallback" class="manual-copy" hidden><label for="manual-copy">Copy manually</label><p>Automatic copying is unavailable in this browser. Select and copy the text below.</p><textarea id="manual-copy" rows="6" readonly></textarea></div>
    </div><aside class="handoff"><h2>Next stop: ${esc(agent.name)}</h2><ol>${agent.setupSteps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol><a class="button primary" href="${esc(agent.setupUrl)}" target="_blank" rel="noopener noreferrer">Open setup guide ${icon('external')}<span class="sr-only"> (opens in new tab)</span></a><div class="delivery-note"><h3>Delivery: ${esc(channel.label)}</h3><p>${esc(channel.hint || '')}</p></div><p class="small muted">Nothing has been connected or scheduled by nuntio.</p></aside></div></div>`;
  bindCreatorCopy();
  document.querySelectorAll('[data-copy]').forEach((element) => element.addEventListener('click', () => {
    const button = /** @type {HTMLButtonElement} */ (element);
    const key = /** @type {keyof typeof output} */ (button.dataset.copy);
    void copy(output[key], button, `${key === 'prompt' ? 'Setup prompt' : key === 'schedule' ? 'Recommended schedule' : 'Guardrails checklist'} copied.`);
  }));
  document.querySelector('#share-link')?.addEventListener('click', (event) => {
    const url = new URL(`playbooks/${playbook.id}/index.html`, new URL(root, location.href));
    url.hash = answerHash('/output', answers);
    void copy(url.href, /** @type {HTMLButtonElement} */ (event.currentTarget), 'Share link copied. It includes your answers.');
  });
}

function renderGuide() {
  document.title = 'How nuntio works | nuntio';
  app.innerHTML = `<div class="wrap guide"><a class="back-link" href="${homeHref()}">${icon('back')} All playbooks</a><h1 id="page-title" tabindex="-1">A little setup.<br>A clearer starting point.</h1><p class="guide-intro">nuntio turns your goal into a prompt, a recommended schedule, and a checklist. You take them to your assistant.</p>
    <section aria-labelledby="how-heading"><h2 id="how-heading">From an idea to a playbook</h2><ol class="guide-steps"><li><h3>Choose a goal</h3><p>Browse the playbooks or describe what you want. Simple keyword matching finds relevant starting points; it does not generate new playbooks.</p></li><li><h3>Make it yours</h3><p>Choose your experience level, update frequency, and delivery channel. Answer the extra questions for your goal.</p></li><li><h3>Copy, review, then set up</h3><p>Copy the three blocks. Review the prompt, then paste it into your assistant. Confirm its access and schedule there.</p></li></ol></section>
    <section aria-labelledby="verified-heading"><h2 id="verified-heading">Before you use ${esc(defaultAgent.name)}</h2><p class="muted small">Checked against official xAI documentation on ${esc(defaultAgent.verifiedAt)}. Availability can change.</p><div class="capabilities">${defaultAgent.capabilities.map((item) => `<article><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.linkLabel)} ${icon('external')}<span class="sr-only"> (opens in new tab)</span></a></article>`).join('')}</div></section>
    <section aria-labelledby="privacy-heading"><h2 id="privacy-heading">Your answers, in your link</h2><p>Playbook answers stay in your URL after the #. Scanning sends the address you enter to the selected chain’s public RPC provider and, if needed, its fallback. nuntio uses no account, cookies, analytics or database.</p><p>Anyone with a configured link can read the answers. The link may also remain in your browser history. Keep private details out. A social preview shows the playbook title, not your answers.</p></section>
    <section aria-labelledby="limits-heading"><h2 id="limits-heading">A playbook is a starting point</h2><p>nuntio does not run an assistant, search X, send updates, post content, apply for jobs, or create schedules. These prompts ask your assistant to prepare research and drafts for you to review. Instructions are not an enforcement mechanism; check the assistant’s permissions and results.</p><p>There are no wallet connections, trades, or custody features. Meme coin research is speculative and you can lose all your money. Not financial advice.</p><p>nuntio is an independent project and is not affiliated with xAI.</p></section><a class="button primary" href="${homeHref()}">Choose a playbook ${icon('arrow')}</a></div>`;
}

function renderNotFound() {
  document.title = 'Playbook not found | nuntio';
  app.innerHTML = `<div class="wrap not-found"><h1 id="page-title" tabindex="-1">That page isn’t here.</h1><p>Choose a playbook to get started again.</p><a class="button primary" href="${homeHref()}">See all playbooks ${icon('arrow')}</a></div>`;
}

function render() {
  const route = parseRoute(location.hash);
  const playbook = catalog.playbooks.find(({ id }) => id === pageId);
  const setupGuide = guideCatalog.guides.find(({ id }) => id === (guideId || route.view.replace(/^\/guides\//, '')));
  const section = guideId || route.view === '/guides' || route.view.startsWith('/guides/') ? 'guides' : route.view === '/roadmap' ? 'roadmap' : route.view === '/launches' ? 'launches' : route.view.startsWith('/scan') ? 'scan' : 'playbooks';
  document.querySelectorAll('[data-section]').forEach((link) => {
    if (/** @type {HTMLElement} */ (link).dataset.section === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (guideId) {
    if (setupGuide && route.view === '/') renderSetupGuide(setupGuide);
    else renderNotFound();
  } else if (playbook) {
    const { answers, repaired } = readAnswers(playbook, catalog, route.params);
    if (route.view === '/output' && !route.malformed && !repaired && Object.keys(validateAnswers(playbook, answers)).length === 0) renderOutput(playbook, answers);
    else if (['/', '/configure', '/output'].includes(route.view)) renderConfigure(playbook, answers, repaired || route.malformed || route.view === '/output');
    else renderNotFound();
  } else if (pageId) renderNotFound();
  else if (route.view === '/') renderHome();
  else if (route.view === '/guide') renderGuide();
  else if (route.view === '/guides') renderGuides();
  else if (route.view === '/roadmap') renderRoadmap();
  else if (route.view === '/launches') launchesView.renderLaunches();
  else if (route.view === '/scan') scanView.renderScan(route.params);
  else if (route.view === '/scan/output') { if (!scanView.renderSaved(route.params)) renderNotFound(); }
  else if (route.view.startsWith('/guides/') && setupGuide) renderSetupGuide(setupGuide);
  else renderNotFound();
  if (!firstRender) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.querySelector('#page-title')?.scrollIntoView({ block: 'nearest' });
    /** @type {HTMLElement | null} */ (document.querySelector('#page-title'))?.focus({ preventScroll: true });
  }
  firstRender = false;
}

const scanView = createScanView({ app, icon, copy, announce, esc });
const launchesView = createLaunchesView({ app, icon, announce, esc, homeHref });
shell();
window.addEventListener('hashchange', render);
document.querySelector('#skip-link')?.addEventListener('click', (event) => { event.preventDefault(); app.focus(); app.scrollIntoView(); });
render();
