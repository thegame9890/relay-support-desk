import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('company monitor exposes the active answer stage and clears it after completion', { timeout: 10000 }, async () => {
  const mock = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: 'A specialist should review the agreement. Source: POL-EXCEPT-01' } }));
    }, 450);
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'relay-progress-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), DATA_PATH: join(dir, 'data.json'), SUPPORT_MODE: 'free', USE_OLLAMA: 'true', OLLAMA_BASE_URL: `http://127.0.0.1:${mock.address().port}` },
    stdio: 'ignore'
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await fetch(`${base}/api/status`); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, 'server started');
    const conversation = await (await fetch(`${base}/api/conversations`, { method: 'POST' })).json();
    const path = `${base}/api/conversations/${conversation.id}`;
    const pending = fetch(`${path}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'My signed contract contradicts your refund policy.' }) });
    let progress;
    for (let attempt = 0; attempt < 20; attempt++) {
      progress = await (await fetch(`${path}/progress`)).json();
      if (progress?.stages.some(stage => stage.title === 'Answer model')) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(progress?.question, 'My signed contract contradicts your refund policy.');
    assert.ok(progress.stages.some(stage => stage.title === 'Answer model'));
    const result = await (await pending).json();
    assert.equal(result.assistantMessage.trace.actualRoute, 'premium');
    assert.equal(await (await fetch(`${path}/progress`)).json(), null);
  } finally {
    child.kill();
    mock.close();
    await rm(dir, { recursive: true, force: true });
  }
});
