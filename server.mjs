import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { routeWithJev, replayDecision } from './lib/jev.mjs';
import { routeWithLocalDecision } from './lib/local-decision.mjs';
import { localAnswer, advancedLocalAnswer, premiumAnswer, fallbackAnswer, outOfScopeAnswer } from './lib/providers.mjs';
import { knowledge } from './lib/knowledge.mjs';
import { summarizeCosts } from './lib/cost.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(root, 'public');
const store = new Store(process.env.DATA_PATH || join(root, 'data', 'support.json'));
const activeDecisions = new Map();

try {
  const env = await readFile(join(root, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }

const config = {
  port: Number(process.env.PORT || 3000),
  supportMode: process.env.SUPPORT_MODE === 'external' ? 'external' : 'free',
  routerProvider: process.env.ROUTER_PROVIDER || 'local',
  threshold: Number(process.env.ROUTE_THRESHOLD || 0.72),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:1.7b',
  ollamaAdvancedModel: process.env.OLLAMA_ADVANCED_MODEL || 'qwen3:8b',
  ollamaEnabled: process.env.USE_OLLAMA === 'true',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  premiumEnabled: process.env.SUPPORT_MODE === 'external' && Boolean(process.env.OPENAI_API_KEY),
  jevKey: process.env.TYPESAFE_API_KEY || '',
  jevModel: process.env.JEV_MODEL || 'jev-latest',
  jevEndpoint: process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone'
};

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const error = (res, status, message) => json(res, status, { error: message });
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 15000) throw new Error('Request is too large');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
}
const round = value => Number(value.toFixed(5));
const estimateCost = (text, route) => {
  const tokens = Math.max(30, Math.ceil(text.length / 4) + 120);
  return round(route === 'premium' ? tokens * 0.000002 : route === 'local' ? tokens * 0.00000015 : 0);
};
const estimateWork = (text, route, routerUsed = false) => {
  const tokens = Math.max(30, Math.ceil(text.length / 4) + 120);
  return Math.round(tokens * ((route === 'local' ? 1 : route === 'premium' ? 4 : 0) + (routerUsed ? 1 : 0)));
};
const publicConversation = conversation => ({ ...conversation });

async function handleApi(req, res, path) {
  if (req.method === 'GET' && path === '/api/status') return json(res, 200, {
    mode: config.supportMode === 'free' ? (config.ollamaEnabled ? 'free-local' : 'demo') : 'external',
    supportMode: config.supportMode,
    local: config.ollamaEnabled ? `Ollama · ${config.ollamaModel}` : 'Verified policy demo',
    premium: config.supportMode === 'free' ? (config.ollamaEnabled ? `Ollama advanced · ${config.ollamaAdvancedModel}` : 'Advanced simulation') : config.premiumEnabled ? `OpenAI · ${config.openaiModel}` : 'Premium simulation',
    router: config.supportMode === 'external' && config.routerProvider === 'jev' && config.jevKey ? `Jev · ${config.jevModel}` : config.ollamaEnabled ? `Local choice model · ${config.ollamaModel}` : 'Local routing rules',
    threshold: config.threshold,
    knowledgeCount: knowledge.length
  });
  if (req.method === 'GET' && path === '/api/knowledge') return json(res, 200, knowledge.map(({ keywords, ...doc }) => doc));
  if (req.method === 'GET' && path === '/api/tickets') return json(res, 200, store.data.tickets.slice(0, 50));
  if (req.method === 'GET' && path === '/api/costs') return json(res, 200, summarizeCosts(store.data.conversations));
  if (req.method === 'GET' && path === '/api/conversations') return json(res, 200, store.data.conversations.map(c => ({ id: c.id, createdAt: c.createdAt, preview: c.messages.find(m => m.role === 'user')?.text || 'New conversation', count: c.messages.length })));
  if (req.method === 'POST' && path === '/api/conversations') return json(res, 201, publicConversation(await store.createConversation()));
  const match = path.match(/^\/api\/conversations\/([a-f0-9-]+)(?:\/(messages|replay|tickets|progress))?$/);
  if (match) {
    const conversation = store.conversation(match[1]);
    if (!conversation) return error(res, 404, 'Conversation not found');
    if (req.method === 'GET' && !match[2]) return json(res, 200, publicConversation(conversation));
    if (req.method === 'GET' && match[2] === 'progress') {
      const current = activeDecisions.get(conversation.id);
      if (current && Date.now() - current.startedAt > 60000) activeDecisions.delete(conversation.id);
      return json(res, 200, activeDecisions.get(conversation.id) || null);
    }
    if (req.method === 'POST' && match[2] === 'messages') {
      const input = await body(req);
      const question = String(input.text || '').trim();
      if (!question || question.length > 2000) return error(res, 400, 'Message must be 1–2000 characters');
      const simulation = Boolean(input.simulateOutage);
      const start = performance.now();
      const progress = { question, startedAt: Date.now(), stages: [{ title: 'Question received', detail: 'Customer message accepted for routing.' }] };
      const stage = (title, detail) => progress.stages.push({ title, detail });
      activeDecisions.set(conversation.id, progress);
      stage('Scope and policy check', 'Checking whether the question belongs to this support desk and searching approved policies.');
      const decision = config.supportMode === 'external' && config.routerProvider === 'jev'
        ? await routeWithJev(question, config.threshold, config)
        : await routeWithLocalDecision(question, config.threshold, config);
      stage('Policy retrieval', decision.route === 'out_of_scope' ? 'Skipped for a request outside support scope.' : decision.sources.length ? `Matched ${decision.sources.map(source => source.id).join(', ')}.` : 'No approved policy matched.');
      stage('Routing decision', `${decision.route === 'premium' && config.supportMode === 'free' ? 'Advanced local model' : decision.route.replaceAll('_', ' ')}. ${decision.reason}`);
      let response, actualRoute = decision.route, failure = null;
      try {
        if (decision.route === 'out_of_scope') {
          stage('Support redirect', 'The request is outside support scope; no answer model is called.');
          response = { text: outOfScopeAnswer(), provider: 'scope guardrail', model: 'deterministic' };
        }
        else if (decision.route === 'premium') {
          stage('Answer model', config.supportMode === 'free' ? `Asking local ${config.ollamaAdvancedModel} to handle this case.` : `Asking ${config.openaiModel} to handle this case.`);
          if (simulation) throw new Error(config.supportMode === 'free' ? 'Simulated advanced local model outage' : 'Simulated premium API rate limit');
          response = config.supportMode === 'external' ? await premiumAnswer(question, decision.sources, config) : await advancedLocalAnswer(question, decision.sources, config);
        } else {
          stage('Answer model', config.ollamaEnabled ? `Asking local ${config.ollamaModel} to answer from the matched policy.` : 'Using the verified policy text.');
          response = await localAnswer(question, decision.sources.slice(0, 1), config);
        }
        if (!response.text) throw new Error('Model returned no supported answer');
      } catch (err) {
        failure = err.message;
        actualRoute = 'fallback';
        stage('Fallback', `Answer provider failed: ${failure}. Returning a deterministic policy response or human review request.`);
        response = { text: fallbackAnswer(decision.sources[0]), provider: 'verified policy fallback', model: 'deterministic' };
      }
      const sourceIds = decision.sources.map(source => source.id);
      const trace = {
        plannedRoute: decision.route, actualRoute, reason: decision.reason,
        confidence: decision.confidence, threshold: decision.threshold,
        decisionEngine: decision.decisionEngine, localProbability: decision.localProbability ?? null,
        modelChoice: decision.modelChoice ?? null,
        jevConfidence: decision.jevConfidence ?? null, jevModel: decision.jevModel ?? null,
        jevUsage: decision.jevUsage ?? null, routerFailure: decision.routerFailure ?? null,
        sourceIds, provider: response.provider, model: response.model,
        failure, simulatedFailure: simulation && Boolean(failure),
        latencyMs: Math.round(performance.now() - start),
        estimatedCostUsd: config.supportMode === 'free' ? 0 : estimateCost(question + response.text, actualRoute),
        createdAt: new Date().toISOString()
      };
      const userMessage = { id: crypto.randomUUID(), role: 'user', text: question, createdAt: new Date().toISOString() };
      const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: response.text, trace, createdAt: new Date().toISOString() };
      conversation.messages.push(userMessage, assistantMessage);
      await store.save();
      activeDecisions.delete(conversation.id);
      return json(res, 201, { userMessage, assistantMessage });
    }
    if (req.method === 'POST' && match[2] === 'replay') {
      const input = await body(req);
      const threshold = Number(input.threshold ?? config.threshold);
      if (!Number.isFinite(threshold) || threshold < 0.3 || threshold > 0.95) return error(res, 400, 'Threshold must be between 0.30 and 0.95');
      const pairs = conversation.messages.filter(message => message.role === 'user').map((user, index) => ({ user, assistant: conversation.messages.filter(m => m.role === 'assistant')[index] }));
      const rows = pairs.map(({ user, assistant }) => {
        const decision = replayDecision(user.text, threshold, assistant?.trace);
        const route = assistant?.trace?.simulatedFailure && decision.route === 'premium' ? 'fallback' : decision.route;
        const text = user.text + (assistant?.text || '');
        const cost = config.supportMode === 'free' ? 0 : estimateCost(text, route);
        const baselineCost = config.supportMode === 'free' ? 0 : estimateCost(text, 'premium');
        const routerUsed = assistant?.trace?.decisionEngine === 'local choice model';
        return { question: user.text, originalRoute: assistant?.trace?.actualRoute || null, replayRoute: route, confidence: decision.confidence, decisionEngine: decision.decisionEngine, reason: decision.reason, estimatedCostUsd: cost, baselineCostUsd: baselineCost, estimatedWork: estimateWork(text, route, routerUsed), baselineWork: estimateWork(text, 'premium'), estimatedLatencyMs: route === 'out_of_scope' ? 20 : route === 'local' ? 400 : route === 'fallback' ? 100 : 1800, baselineLatencyMs: 1800 };
      });
      const sum = key => round(rows.reduce((total, row) => total + row[key], 0));
      return json(res, 200, { threshold, comparisonMode: config.supportMode, method: 'Routing recomputed from saved messages and saved model choices. Work, cost, and latency are illustrative estimates; no model calls are made.', rows, totals: { dispatcherCostUsd: sum('estimatedCostUsd'), baselineCostUsd: sum('baselineCostUsd'), dispatcherWork: rows.reduce((a, b) => a + b.estimatedWork, 0), baselineWork: rows.reduce((a, b) => a + b.baselineWork, 0), dispatcherLatencyMs: rows.reduce((a, b) => a + b.estimatedLatencyMs, 0), baselineLatencyMs: rows.reduce((a, b) => a + b.baselineLatencyMs, 0), premiumCalls: rows.filter(row => row.replayRoute === 'premium').length, baselinePremiumCalls: rows.length } });
    }
    if (req.method === 'POST' && match[2] === 'tickets') {
      const input = await body(req);
      const note = String(input.note || '').trim().slice(0, 1000);
      const ticket = await store.addTicket({ conversationId: conversation.id, note, messageCount: conversation.messages.length });
      return json(res, 201, ticket);
    }
  }
  if (req.method === 'POST' && path === '/api/feedback') {
    const input = await body(req);
    const conversation = store.conversation(String(input.conversationId || ''));
    const message = conversation?.messages.find(item => item.id === input.messageId && item.role === 'assistant');
    if (!message) return error(res, 404, 'Answer not found');
    if (!['up', 'down'].includes(input.rating)) return error(res, 400, 'Invalid rating');
    const feedback = await store.addFeedback({ conversationId: conversation.id, messageId: message.id, rating: input.rating, note: String(input.note || '').trim().slice(0, 1000), route: message.trace.actualRoute });
    return json(res, 201, feedback);
  }
  if (req.method === 'GET' && path === '/api/feedback/summary') {
    const feedback = store.data.feedback;
    return json(res, 200, { total: feedback.length, positive: feedback.filter(x => x.rating === 'up').length, negative: feedback.filter(x => x.rating === 'down').length, preferences: store.data.preferences.length, recent: feedback.slice(0, 10) });
  }
  if (req.method === 'GET' && path === '/api/preferences/export') {
    const lines = store.data.preferences.map(item => JSON.stringify({ prompt: item.prompt, chosen: item.chosen, rejected: item.rejected, source_ids: item.sourceIds }));
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': 'attachment; filename="relay-preferences.jsonl"' });
    return res.end(lines.join('\n') + (lines.length ? '\n' : ''));
  }
  if (req.method === 'POST' && path === '/api/preferences') {
    const input = await body(req);
    const conversation = store.conversation(String(input.conversationId || ''));
    const answer = conversation?.messages.find(item => item.id === input.messageId && item.role === 'assistant');
    const index = conversation?.messages.indexOf(answer);
    const question = index > 0 ? conversation.messages[index - 1] : null;
    const chosen = String(input.chosen || '').trim();
    if (!answer || question?.role !== 'user') return error(res, 404, 'Answer not found');
    if (chosen.length < 10 || chosen.length > 3000) return error(res, 400, 'Preferred answer must be 10–3000 characters');
    if (chosen === answer.text) return error(res, 400, 'Preferred answer must differ from the original');
    const preference = await store.addPreference({ conversationId: conversation.id, messageId: answer.id, prompt: question.text, chosen, rejected: answer.text, sourceIds: answer.trace.sourceIds, reviewerNote: String(input.note || '').trim().slice(0, 1000) });
    return json(res, 201, preference);
  }
  return error(res, 404, 'Not found');
}

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serveStatic(res, path) {
  const file = resolve(publicDir, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(publicDir + '\\') && file !== publicDir) return error(res, 403, 'Forbidden');
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` }); res.end(data); }
  catch { error(res, 404, 'Not found'); }
}

await store.init();
http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) await handleApi(req, res, path);
    else if (req.method === 'GET') await serveStatic(res, path);
    else error(res, 405, 'Method not allowed');
  } catch (err) { error(res, err.message === 'Request is too large' || err.message === 'Invalid JSON' ? 400 : 500, err.message); }
}).listen(config.port, '127.0.0.1', () => console.log(`Support Traffic Controller at http://localhost:${config.port}`));
