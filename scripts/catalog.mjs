import assert from 'node:assert/strict';
import { PLACEHOLDER, standardFields } from '../src/model.js';

/** Fail the build on an incomplete data-only extension. */
export function validateCatalog(catalog) {
  assert.equal(catalog.version, 1, 'Unsupported catalog version');
  assert.ok(catalog.agents.length && catalog.playbooks.length, 'Add assistants and playbooks');
  for (const key of ['experiences', 'frequencies']) {
    assert.ok(catalog[key].length, `${key} must not be empty`);
    assert.equal(new Set(catalog[key].map((option) => option.value)).size, catalog[key].length, `Duplicate ${key}`);
    for (const option of catalog[key]) assert.ok(option.value && option.label);
  }
  const agents = new Set();
  for (const agent of catalog.agents) {
    assert.match(agent.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!agents.has(agent.id), 'Duplicate assistant');
    agents.add(agent.id);
    assert.ok(agent.name && agent.channels.length && agent.setupSteps.length && agent.capabilities.length);
    for (const key of ['docsUrl', 'setupUrl', 'routinesUrl', 'appsUrl']) assert.equal(new URL(agent[key]).protocol, 'https:');
    for (const capability of agent.capabilities) assert.equal(new URL(capability.url).protocol, 'https:');
  }
  assert.ok(agents.has(catalog.defaultAgentId), 'Unknown default assistant');
  const ids = new Set();
  for (const playbook of catalog.playbooks) {
    assert.match(playbook.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(playbook.id), 'Duplicate playbook');
    ids.add(playbook.id);
    assert.ok(agents.has(playbook.agentId), 'Unknown assistant');
    assert.ok(playbook.title && playbook.description && playbook.category && playbook.icon && playbook.deliverables.length);
    assert.ok(playbook.keywords.length && playbook.schedule && playbook.guardrails);
    if (playbook.defaultFrequency !== null) assert.ok(catalog.frequencies.some((option) => option.value === playbook.defaultFrequency), `Unknown default frequency: ${playbook.id}`);
    const fields = new Set(standardFields(playbook));
    for (const question of playbook.questions) {
      assert.match(question.key, /^[a-z][A-Za-z]*$/);
      assert.ok(!fields.has(question.key) && !['experience', 'frequency', 'channel'].includes(question.key), 'Duplicate question');
      fields.add(question.key);
      assert.ok(question.label && question.placeholder && question.hint);
      assert.ok(Number.isInteger(question.maxLength) && question.maxLength > 0 && question.maxLength <= 500);
    }
    const placeholders = [...playbook.prompt.matchAll(PLACEHOLDER)].map((match) => match[1]);
    assert.deepEqual(new Set(placeholders), fields, `Questions and template placeholders differ: ${playbook.id}`);
    assert.ok(playbook.checklistSeparator === null || typeof playbook.checklistSeparator === 'string');
    if (playbook.riskWarning) assert.ok(playbook.riskWarning.includes('Not financial advice.'));
    for (const field of ['author', 'tipAddress']) {
      if (playbook[field] === undefined) continue;
      assert.equal(typeof playbook[field], 'string', `${field} must be a string: ${playbook.id}`);
      assert.ok(playbook[field].trim() && playbook[field] === playbook[field].trim(), `${field} must be nonempty without surrounding whitespace: ${playbook.id}`);
      assert.ok(!/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(playbook[field]), `${field} must be plain, single-line text: ${playbook.id}`);
    }
  }
}

/** Roadmap groups are plans only; Live is generated from the real catalogs in the app. */
export function validateRoadmap(roadmap) {
  assert.equal(roadmap.version, 1, 'Unsupported roadmap version');
  assert.deepEqual(roadmap.groups.map(({ id }) => id), ['next', 'later', 'exploring'], 'Roadmap groups must be next, later and exploring');
  for (const group of roadmap.groups) {
    assert.ok(group.title && group.icon && group.items.length, `Incomplete roadmap group: ${group.id}`);
    for (const item of group.items) assert.ok(item.title && item.text, `Incomplete roadmap item in ${group.id}`);
  }
  assert.ok(roadmap.disclaimer.includes('No token has been launched.'), 'Keep the roadmap disclaimer');
}
