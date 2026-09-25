import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('server uses Jev decision and records it in the trace', { timeout: 20000 }, async () => {
  const mock = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    assert.equal(input.questions.route.type, 'choice');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-test', answers: { route: { type: 'choice', choice: 'premium', probabilities: { local: 0.2, premium: 0.8 }, confidence: 0.7 } }, usage: { input_tokens: 100, output_tokens: 20 } }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;
  const dir = await mkdtemp(join(tmpdir(), 'relay-jev-test-'));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_PATH: join(dir, 'data.json'), SUPPORT_MODE: 'external', ROUTER_PROVIDER: 'jev', TYPESAFE_API_KEY: 'test-key', JEV_ENDPOINT: `http://127.0.0.1:${mockPort}/v1/systemone`, OPENAI_API_KEY: '', USE_OLLAMA: 'false' }
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (path, data) => {
    const response = await fetch(base + path, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await request('/api/status'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready);
    const status = await request('/api/status');
    assert.match(status.router, /Jev/);
    const conversation = await request('/api/conversations', {});
    const message = await request(`/api/conversations/${conversation.id}/messages`, { text: 'When will my refund arrive?' });
    assert.equal(message.assistantMessage.trace.decisionEngine, 'Jev');
    assert.equal(message.assistantMessage.trace.localProbability, 0.2);
    assert.equal(message.assistantMessage.trace.plannedRoute, 'premium');
    const replay = await request(`/api/conversations/${conversation.id}/replay`, { threshold: 0.72 });
    assert.equal(replay.rows[0].decisionEngine, 'Jev saved decision');
    assert.equal(replay.rows[0].replayRoute, 'premium');
  } finally {
    child.kill();
    await new Promise(resolve => mock.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
