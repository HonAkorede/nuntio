/** @typedef {import('./types').Catalog} Catalog */
/** @typedef {import('./types').Playbook} Playbook */
/** @typedef {import('./types').Answers} Answers */

/** @param {string} value */
export function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}

/** @param {string} value */
export function normalize(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Word and phrase matching, never substring matches inside unrelated words.
 * @param {string} query @param {Playbook[]} playbooks */
export function matchPlaybooks(query, playbooks) {
  const text = ` ${normalize(query)} `;
  if (!text.trim()) return playbooks.map((playbook) => ({ playbook, score: 0 }));
  return playbooks.map((playbook) => ({
    playbook,
    score: playbook.keywords.reduce((score, keyword) => {
      const phrase = normalize(keyword);
      return score + (text.includes(` ${phrase} `) ? phrase.split(' ').length : 0);
    }, 0),
  })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

/** @param {Playbook} playbook @param {Catalog} catalog */
export function agentFor(playbook, catalog) {
  const agent = catalog.agents.find(({ id }) => id === playbook.agentId);
  if (!agent) throw new Error(`Unknown assistant: ${playbook.agentId}`);
  return agent;
}

/** Placeholder names: a lowercase start, then letters (for example {hoursPerDay}). */
export const PLACEHOLDER = /\{([a-z][A-Za-z]*)\}/g;

/** The standard questions a playbook asks. Channel is always asked. Experience is asked when the
 * prompt uses it, and frequency when the playbook has a schedule (defaultFrequency is null for on demand).
 * @param {Playbook} playbook @returns {('experience' | 'frequency' | 'channel')[]} */
export function standardFields(playbook) {
  /** @type {('experience' | 'frequency' | 'channel')[]} */
  const fields = [];
  if (playbook.prompt.includes('{experience}')) fields.push('experience');
  if (playbook.defaultFrequency !== null) fields.push('frequency');
  fields.push('channel');
  return fields;
}

/** @param {Playbook} playbook @param {Catalog} catalog @returns {Answers} */
export function defaultsFor(playbook, catalog) {
  const fields = standardFields(playbook);
  /** @type {[string, string][]} */
  const standard = [];
  if (fields.includes('experience')) standard.push(['experience', catalog.experiences[0].value]);
  if (playbook.defaultFrequency !== null) standard.push(['frequency', playbook.defaultFrequency]);
  standard.push(['channel', agentFor(playbook, catalog).channels[0].value]);
  return Object.fromEntries([...standard, ...playbook.questions.map(({ key }) => [key, ''])]);
}

/** @param {string} hash @returns {import('./types').Route} */
export function parseRoute(hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const index = raw.indexOf('?');
  const view = index < 0 ? raw : raw.slice(0, index);
  const query = index < 0 ? '' : raw.slice(index + 1);
  if (raw.length > 8000 || /%(?![0-9a-f]{2})/i.test(query)) return { view, params: new URLSearchParams(), malformed: true };
  const params = new URLSearchParams(query);
  return { view, params, malformed: [...params.values()].some((value) => value.includes('\uFFFD')) };
}

/** Only known fields reach the form; untrusted hash data remains text.
 * @param {Playbook} playbook @param {Catalog} catalog @param {URLSearchParams} params */
export function readAnswers(playbook, catalog, params) {
  const answers = defaultsFor(playbook, catalog);
  let repaired = false;
  /** @type {Record<string, import('./types').Choice[]>} */
  const all = { experience: catalog.experiences, frequency: catalog.frequencies, channel: agentFor(playbook, catalog).channels };
  for (const key of standardFields(playbook)) {
    const options = all[key];
    const value = params.get(key);
    if (value !== null) {
      if (options.some((option) => option.value === value)) answers[key] = value;
      else repaired = true;
    }
  }
  for (const { key, maxLength } of playbook.questions) {
    const value = params.get(key);
    if (value !== null) {
      const safe = value.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, maxLength);
      answers[key] = safe;
      if (value !== safe) repaired = true;
    }
  }
  return { answers, repaired };
}

/** @param {string} view @param {Answers} answers */
export function answerHash(view, answers) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(answers)) params.set(key, value);
  return `#${view}?${params}`;
}

/** @param {Playbook} playbook @param {Answers} answers */
export function validateAnswers(playbook, answers) {
  /** @type {Record<string, string>} */
  const errors = {};
  for (const question of playbook.questions) {
    const value = answers[question.key] || '';
    if (!value.trim()) errors[question.key] = 'Add an answer to continue.';
    else if (value.length > question.maxLength) errors[question.key] = `Use ${question.maxLength} characters or fewer.`;
  }
  return errors;
}

/** Replacement is literal and single-pass, including user-supplied braces and dollar signs.
 * @param {string} template @param {Answers} answers */
export function fillTemplate(template, answers) {
  return template.replace(PLACEHOLDER, (_, key) => {
    if (!Object.hasOwn(answers, key) || !answers[key].trim()) throw new Error(`Missing answer: ${key}`);
    return answers[key].trim();
  });
}

/** Preserve the supplied body verbatim; a separate risk notice travels with each research block.
 * @param {Playbook} playbook @param {Answers} answers */
export function createOutputs(playbook, answers) {
  const notice = playbook.riskWarning ? `\n\n${playbook.riskWarning}` : '';
  return {
    prompt: fillTemplate(playbook.prompt, answers) + notice,
    schedule: playbook.schedule + notice,
    guardrails: playbook.guardrails + notice,
  };
}
