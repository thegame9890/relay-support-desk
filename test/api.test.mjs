import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('full support journey: local, fallback, replay, feedback, preference, ticket', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-test-'));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, match => match.slice(1)), env: { ...process.env, PORT: String(port), DATA_PATH: join(dir, 'data.json'), OPENAI_API_KEY: '', USE_OLLAMA: 'false' }, stdio: 'ignore' });
  const request = async (path, method = 'GET', data) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
    return path.endsWith('/export') ? response.text() : response.json();
  };
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { await request('/api/status'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'server started');
    const conversation = await request('/api/conversations', 'POST', {});
    const local = await request(`/api/conversations/${conversation.id}/messages`, 'POST', { text: 'When will my refund arrive?' });
    assert.equal(local.assistantMessage.trace.actualRoute, 'local');
    assert.match(local.assistantMessage.text, /POL-REFUND-01/);
    const unrelated = await request(`/api/conversations/${conversation.id}/messages`, 'POST', { text: 'Can you write code to add 2 numbers?' });
    assert.equal(unrelated.assistantMessage.trace.actualRoute, 'out_of_scope');
    assert.equal(unrelated.assistantMessage.trace.provider, 'scope guardrail');
    assert.match(unrelated.assistantMessage.text, /orders, shipping, returns, refunds/i);
    assert.doesNotMatch(unrelated.assistantMessage.text, /python|javascript|function/i);
    const fallback = await request(`/api/conversations/${conversation.id}/messages`, 'POST', { text: 'My signed contract contradicts your refund policy.', simulateOutage: true });
    assert.equal(fallback.assistantMessage.trace.actualRoute, 'fallback');
    assert.match(fallback.assistantMessage.text, /human review/i);
    const replay = await request(`/api/conversations/${conversation.id}/replay`, 'POST', { threshold: 0.72 });
    assert.equal(replay.rows.length, 3);
    assert.equal(replay.rows[1].replayRoute, 'out_of_scope');
    assert.equal(replay.rows[1].estimatedWork, 0);
    assert.equal(replay.rows[2].replayRoute, 'fallback');
    assert.equal(replay.comparisonMode, 'free');
    assert.equal(replay.totals.dispatcherCostUsd, 0);
    assert.ok(replay.totals.dispatcherWork < replay.totals.baselineWork);
    await request('/api/feedback', 'POST', { conversationId: conversation.id, messageId: local.assistantMessage.id, rating: 'down', note: 'Needs a clearer opening' });
    await request('/api/preferences', 'POST', { conversationId: conversation.id, messageId: local.assistantMessage.id, chosen: 'Your approved refund should reach your original payment method within 5–10 business days. Source: POL-REFUND-01' });
    const dataset = await request('/api/preferences/export');
    assert.match(dataset, /"chosen"/);
    const ticket = await request(`/api/conversations/${conversation.id}/tickets`, 'POST', { note: 'Please review the signed agreement' });
    assert.equal(ticket.status, 'open');
    const tickets = await request('/api/tickets');
    assert.equal(tickets.length, 1);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
