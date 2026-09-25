import test from 'node:test';
import assert from 'node:assert/strict';
import { routeWithLocalDecision } from '../lib/local-decision.mjs';
import { replayDecision } from '../lib/jev.mjs';

const config = { ollamaEnabled: true, ollamaBaseUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen3:1.7b' };
const answer = choice => async (_url, options) => {
  const request = JSON.parse(options.body);
  assert.equal(request.model, 'qwen3:1.7b');
  assert.deepEqual(request.format.properties.choice.enum, ['local', 'advanced']);
  return { ok: true, json: async () => ({ message: { content: JSON.stringify({ choice, reason: 'Test decision' }) } }) };
};

test('local typed model accepts a grounded FAQ', async () => {
  const decision = await routeWithLocalDecision('When will my refund arrive?', 0.72, config, answer('local'));
  assert.equal(decision.route, 'local');
  assert.equal(decision.decisionEngine, 'local choice model');
});

test('local typed model can escalate a grounded question', async () => {
  const decision = await routeWithLocalDecision('When will my refund arrive?', 0.72, config, answer('advanced'));
  assert.equal(decision.route, 'premium');
  assert.equal(decision.modelChoice, 'advanced');
});

test('local model outage falls back to rules', async () => {
  const decision = await routeWithLocalDecision('When will my refund arrive?', 0.72, config, async () => { throw new Error('offline'); });
  assert.equal(decision.route, 'local');
  assert.equal(decision.decisionEngine, 'rules fallback');
});

test('sensitive case bypasses the local model', async () => {
  const decision = await routeWithLocalDecision('My signed contract contradicts your refund policy.', 0.72, config, () => { throw new Error('should not call'); });
  assert.equal(decision.route, 'premium');
  assert.equal(decision.decisionEngine, 'rules guardrail');
});

test('unrelated coding request bypasses the local model', async () => {
  const decision = await routeWithLocalDecision('Can you write code to add two numbers?', 0.72, config, () => { throw new Error('should not call'); });
  assert.equal(decision.route, 'out_of_scope');
  assert.equal(decision.decisionEngine, 'rules guardrail');
  assert.deepEqual(decision.sources, []);
  assert.equal(replayDecision('Can you write code to add two numbers?', 0.3, { decisionEngine: 'local choice model', modelChoice: 'local' }).route, 'out_of_scope');
});

test('replay uses the saved local model choice', () => {
  const trace = { decisionEngine: 'local choice model', modelChoice: 'local' };
  assert.equal(replayDecision('When will my refund arrive?', 0.72, trace).route, 'local');
  assert.equal(replayDecision('When will my refund arrive?', 0.96, trace).route, 'premium');
});
