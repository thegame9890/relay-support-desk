import test from 'node:test';
import assert from 'node:assert/strict';
import { routeWithJev, replayDecision } from '../lib/jev.mjs';

const config = { jevKey: 'test-key', jevModel: 'jev-latest', jevEndpoint: 'https://example.test/v1/systemone' };
const response = (choice, local) => async (_url, options) => {
  const request = JSON.parse(options.body);
  assert.equal(request.questions.route.type, 'choice');
  assert.equal(request.model, 'jev-latest');
  assert.equal(options.headers.authorization, 'Bearer test-key');
  return { ok: true, json: async () => ({ model: 'jev-1.13.0', answers: { route: { type: 'choice', choice, probabilities: { local, premium: 1 - local }, confidence: 0.8 } }, usage: { input_tokens: 120, output_tokens: 24 } }) };
};

test('Jev can route a grounded FAQ locally', async () => {
  const decision = await routeWithJev('When will my refund arrive?', 0.72, config, response('local', 0.91));
  assert.equal(decision.route, 'local');
  assert.equal(decision.decisionEngine, 'Jev');
  assert.equal(decision.localProbability, 0.91);
  assert.equal(decision.jevUsage.input_tokens, 120);
});

test('Jev can escalate a question despite a strong keyword match', async () => {
  const decision = await routeWithJev('When will my refund arrive?', 0.72, config, response('premium', 0.28));
  assert.equal(decision.route, 'premium');
});

test('a low local probability forces escalation', async () => {
  const decision = await routeWithJev('When will my refund arrive?', 0.72, config, response('local', 0.61));
  assert.equal(decision.route, 'premium');
});

test('sensitive questions bypass Jev and use the premium guardrail', async () => {
  const decision = await routeWithJev('My signed contract contradicts your refund policy.', 0.72, config, () => { throw new Error('Jev should not be called'); });
  assert.equal(decision.route, 'premium');
  assert.equal(decision.decisionEngine, 'rules guardrail');
});

test('Jev outage falls back to local routing rules', async () => {
  const decision = await routeWithJev('When will my refund arrive?', 0.72, config, async () => ({ ok: false, status: 429 }));
  assert.equal(decision.route, 'local');
  assert.equal(decision.decisionEngine, 'rules fallback');
  assert.match(decision.routerFailure, /429/);
});

test('replay uses saved Jev probability without another call', () => {
  const trace = { decisionEngine: 'Jev', localProbability: 0.8 };
  assert.equal(replayDecision('When will my refund arrive?', 0.72, trace).route, 'local');
  assert.equal(replayDecision('When will my refund arrive?', 0.85, trace).route, 'premium');
});
