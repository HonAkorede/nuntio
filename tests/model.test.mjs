import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { answerHash, createOutputs, defaultsFor, escapeHTML, fillTemplate, matchPlaybooks, parseRoute, readAnswers, validateAnswers } from '../src/model.js';
import { validateCatalog } from '../scripts/catalog.mjs';

const catalog = JSON.parse(readFileSync(new URL('../src/data/playbooks.json', import.meta.url), 'utf8'));
const [coins, content, jobs] = catalog.playbooks;

// These fixtures lock the supplied text after a verbatim comparison with the assignment.
const exactContent = [
  ['7df5e3966b9adfe892362f51f8f65e5b70db296eea3661bd7386de728319d905', 'morning and evening, or every 12 hours.', "never share seed phrases or private keys, never sign anything a bot asks you to sign, verify contracts yourself, never risk money you can't lose."],
  ['1fb97f4789dc8ced5def8e14109093ccdf6614ee3a78b0e268c7a6184eda3d20', 'daily, early morning.', 'you review and post by hand, since automated replies can get an account restricted.'],
  ['109b1daae495b5266b3094589ad056403b21c042ffff20946f061f7a4036cfae', 'weekdays, morning.', 'never pay anyone for a job, never share ID documents early, check the company before replying.'],
];

test('the three supplied prompt templates, schedules, and guardrails stay verbatim', () => {
  assert.equal(catalog.playbooks.length, 11);
  catalog.playbooks.slice(0, 3).forEach((playbook, index) => {
    assert.equal(createHash('sha256').update(playbook.prompt).digest('hex'), exactContent[index][0]);
    assert.equal(playbook.schedule, exactContent[index][1]);
    assert.equal(playbook.guardrails, exactContent[index][2]);
  });
});

test('the catalog is complete, with no unanswered template placeholders', () => validateCatalog(catalog));
for (const [query, expected] of [
  ['I want REMOTE design JOBS!', jobs.id],
  ['Find trending meme coins on Solana', coins.id],
  ['Help me write posts in my voice', content.id],
  ['I am a freelance designer', jobs.id],
  ['Research crypto risks', coins.id],
]) test(`keyword matching: ${query}`, () => assert.equal(matchPlaybooks(query, catalog.playbooks)[0].playbook.id, expected));

test('matching returns relevant ranked alternatives, not an arbitrary fallback', () => {
  const matches = matchPlaybooks('write content posts for crypto jobs', catalog.playbooks);
  assert.equal(matches.length, 3);
  assert.equal(matches[0].playbook.id, content.id);
  assert.ok(matches.every((item, index) => !index || item.score <= matches[index - 1].score));
  assert.equal(matchPlaybooks('baking sourdough bread', catalog.playbooks).length, 0);
  assert.equal(matchPlaybooks('coinage postcard worker', catalog.playbooks).length, 0);
  assert.equal(matchPlaybooks('  ', catalog.playbooks).length, catalog.playbooks.length);
});

test('hash serialization round-trips Unicode, spaces, punctuation and literal braces', () => {
  const answers = { ...defaultsFor(content, catalog), niche: 'Art & design / 東京 #1?', voice: 'Warm + clear {frequency} $&' };
  const route = parseRoute(answerHash('/output', answers));
  assert.equal(route.view, '/output');
  assert.equal(route.malformed, false);
  assert.deepEqual(readAnswers(content, catalog, route.params), { answers, repaired: false });
});

test('the hash cannot replace select values or inject arbitrary properties', () => {
  const { answers, repaired } = readAnswers(jobs, catalog, new URLSearchParams('experience=intruder&frequency=second&channel=unknown&__proto__=bad&role=Designer&location=London'));
  assert.equal(repaired, true);
  assert.equal(answers.experience, 'beginner');
  assert.equal(answers.frequency, 'weekday');
  assert.equal(answers.channel, 'Grok Bot chat');
  assert.equal(Object.hasOwn(answers, '__proto__'), false);
});

test('malformed or oversized links are recoverable', () => {
  for (const hash of ['#/configure?role=%zz', '#/output?role=%FF', '#/output?role=' + 'a'.repeat(8100)]) assert.equal(parseRoute(hash).malformed, true);
  const { answers, repaired } = readAnswers(jobs, catalog, new URLSearchParams({ role: 'a'.repeat(300), location: 'A\nB\u0000C' }));
  assert.equal(repaired, true);
  assert.equal(answers.role.length, 180);
  assert.equal(answers.location, 'A B C');
});

test('whitespace-only and missing required answers fail validation', () => {
  const answers = { ...defaultsFor(jobs, catalog), role: '  ', location: '' };
  assert.deepEqual(Object.keys(validateAnswers(jobs, answers)), ['role', 'location']);
  assert.throws(() => fillTemplate(jobs.prompt, answers), /Missing answer/);
});

test('template replacement is literal, single-pass, and HTML output is escaped', () => {
  assert.equal(fillTemplate('{niche} / {voice}', { niche: '{voice} $&', voice: '<script>alert(1)</script>' }), '{voice} $& / <script>alert(1)</script>');
  assert.equal(escapeHTML('<img src=x onerror="bad"> & \'x\''), '&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; &#39;x&#39;');
});

test('all research copy blocks retain their exact body and a plain financial risk warning', () => {
  const answers = { ...defaultsFor(coins, catalog), chains: 'Solana and Base' };
  const result = createOutputs(coins, answers);
  for (const block of Object.values(result)) {
    assert.ok(block.endsWith(coins.riskWarning));
    assert.ok(block.includes('You can lose all the money you put in. Not financial advice.'));
  }
  assert.equal(result.prompt, fillTemplate(coins.prompt, answers) + '\n\n' + coins.riskWarning);
  assert.equal(result.schedule, coins.schedule + '\n\n' + coins.riskWarning);
  assert.equal(result.guardrails, coins.guardrails + '\n\n' + coins.riskWarning);
});

test('non-research copy blocks exactly match the template, schedule, and guardrails', () => {
  const answers = { ...defaultsFor(jobs, catalog), role: 'designer', location: 'Berlin' };
  const result = createOutputs(jobs, answers);
  assert.equal(result.prompt, fillTemplate(jobs.prompt, answers));
  assert.equal(result.schedule, jobs.schedule);
  assert.equal(result.guardrails, jobs.guardrails);
  assert.ok(!result.prompt.match(/\{[a-z]+\}/));
});

test('a new assistant and playbook can be validated entirely as JSON data', () => {
  const extended = structuredClone(catalog);
  const assistant = { ...extended.agents[0], id: 'another-assistant', name: 'Another assistant', channels: [{ value: 'chat', label: 'Chat' }] };
  extended.agents.push(assistant);
  const playbook = { ...extended.playbooks[2], id: 'another-job-playbook', agentId: assistant.id };
  extended.playbooks.push(playbook);
  validateCatalog(extended);
  assert.equal(defaultsFor(playbook, extended).channel, 'chat');
  const broken = structuredClone(extended);
  broken.playbooks[3].prompt += ' {missing}';
  assert.throws(() => validateCatalog(broken), /Questions and template placeholders differ/);
});
