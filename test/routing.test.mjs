import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMessage } from '../lib/router.mjs';
import { fallbackAnswer } from '../lib/providers.mjs';

const cases = [
  ['When will my refund arrive?', 'local', 'POL-REFUND-01'],
  ['Where is my tracking link?', 'local', 'POL-SHIP-01'],
  ['Can I cancel my order before dispatch?', 'local', 'POL-CANCEL-01'],
  ['My signed contract contradicts your refund policy.', 'premium', 'POL-EXCEPT-01'],
  ['I want a lawyer to review this dispute.', 'premium', 'POL-EXCEPT-01'],
  ['What is the answer to everything?', 'out_of_scope', null],
  ['Can you write code to add two numbers?', 'out_of_scope', null],
  ['Can you write code to calculate a refund?', 'out_of_scope', null],
  ['Can you change the address on my order?', 'premium', null]
];

for (const [question, expectedRoute, expectedSource] of cases) {
  test(`routes: ${question}`, () => {
    const decision = routeMessage(question);
    assert.equal(decision.route, expectedRoute);
    if (expectedSource) assert.equal(decision.sources[0]?.id, expectedSource);
  });
}

test('fallback does not make a contract determination', () => {
  const decision = routeMessage('My signed contract contradicts your refund policy.');
  const answer = fallbackAnswer(decision.sources[0]);
  assert.match(answer, /human review/i);
  assert.doesNotMatch(answer, /5–10 business days/i);
});
