import test from 'node:test';
import assert from 'node:assert/strict';
import { localAnswer } from '../lib/providers.mjs';

test('local answer retries once when the model omits the policy citation', async () => {
  const source = { id: 'POL-REFUND-01', title: 'Refund timing', text: 'Approved refunds return within 5–10 business days.' };
  const config = { ollamaEnabled: true, ollamaBaseUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen3:1.7b' };
  const replies = ['Approved refunds return within 5–10 business days.', 'Approved refunds return within 5–10 business days. Source: POL-REFUND-01'];
  let calls = 0;
  const fakeFetch = async (_url, options) => {
    const input = JSON.parse(options.body);
    assert.equal(input.options.temperature, 0);
    assert.equal(input.messages.length, calls === 0 ? 2 : 4);
    return { ok: true, json: async () => ({ message: { content: replies[calls++] } }) };
  };
  const answer = await localAnswer('When will my refund arrive?', [source], config, fakeFetch);
  assert.equal(calls, 2);
  assert.match(answer.text, /POL-REFUND-01/);
  assert.equal(answer.provider, 'Ollama');
});
