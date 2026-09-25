import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCosts } from '../lib/cost.mjs';

test('cost comparison uses saved answers and labels a paid baseline', () => {
  const empty = summarizeCosts([{ messages: [{ role: 'user', text: 'Unanswered' }] }]);
  assert.equal(empty.answeredQuestions, 0);
  assert.equal(empty.projectedAvoidedPer10kUsd, 0);

  const conversations = [{ messages: [
    { role: 'user', text: 'Refund?' },
    { role: 'assistant', text: 'Within ten days.', trace: { actualRoute: 'local', estimatedCostUsd: 0 } },
    { role: 'user', text: 'Contract dispute?' },
    { role: 'assistant', text: 'Human review.', trace: { actualRoute: 'premium', estimatedCostUsd: 0.0001 } }
  ] }];
  const result = summarizeCosts(conversations);
  assert.equal(result.answeredQuestions, 2);
  assert.deepEqual(result.routes, { local: 1, advanced: 1, fallback: 0, outOfScope: 0 });
  assert.equal(result.relayApiUsd, 0.0001);
  assert.ok(result.baselineUsd > result.relayApiUsd);
  assert.ok(result.projectedAvoidedPer10kUsd > 0);
  assert.equal(result.assumptions.premiumUsdPerMillionTokens, 2);
});
