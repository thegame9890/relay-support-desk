// Creates a reproducible demo dataset through the running API. It does not clear existing data.
// Run only against a fresh local store if you want exactly these conversations.
const base = process.env.RELAY_URL || 'http://127.0.0.1:3000';
const request = async (path, method = 'GET', input) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const status = await request('/api/status');
assert(status.mode === 'free-local' && status.local.startsWith('Ollama') && status.premium.startsWith('Ollama advanced'), 'This script requires the real local Ollama models in free mode.');

const scenarios = [
  { name: 'Returns and cancellation', messages: [
    { text: 'Can I return an unused item within 30 days?', route: 'local', provider: 'Ollama' },
    { text: 'Can I cancel my order before dispatch?', route: 'local', provider: 'Ollama' }
  ] },
  { name: 'Shipping timeline', messages: [
    { text: 'How long does standard shipping usually take after dispatch?', route: 'local', provider: 'Ollama' }
  ] },
  { name: 'Address change needs review', messages: [
    { text: 'Can you change the address on my order?', route: 'premium', provider: 'Ollama advanced' }
  ] },
  { name: 'Unrelated coding request', messages: [
    { text: 'Can you write code to add two numbers?', route: 'out_of_scope', provider: 'scope guardrail' }
  ] },
  { name: 'Specialist outage and fallback', messages: [
    { text: 'My signed contract contradicts your refund policy.', route: 'fallback', provider: 'verified policy fallback', simulateOutage: true }
  ] },
  { name: 'Refund FAQ to contract escalation', messages: [
    { text: 'When will my refund arrive?', route: 'local', provider: 'Ollama' },
    { text: 'My signed agreement promises a different refund timeline. Which one applies?', route: 'premium', provider: 'Ollama advanced' }
  ] }
];

const created = [];
for (const scenario of scenarios) {
  const conversation = await request('/api/conversations', 'POST', {});
  const recorded = { name: scenario.name, id: conversation.id, messages: [] };
  created.push(recorded);
  for (const sample of scenario.messages) {
    const result = await request(`/api/conversations/${conversation.id}/messages`, 'POST', { text: sample.text, simulateOutage: Boolean(sample.simulateOutage) });
    const answer = result.assistantMessage;
    const trace = answer.trace;
    assert(trace.actualRoute === sample.route, `${scenario.name}: expected ${sample.route}, got ${trace.actualRoute}`);
    assert(trace.provider === sample.provider, `${scenario.name}: expected ${sample.provider}, got ${trace.provider}`);
    assert(trace.estimatedCostUsd === 0, `${scenario.name}: expected zero API charge in free mode`);
    if (sample.route === 'local') assert(trace.sourceIds.some(id => answer.text.includes(id)), `${scenario.name}: FAQ answer did not cite a retrieved policy`);
    assert(!/spam folder|associated with your account|address change may not be possible/i.test(answer.text), `${scenario.name}: answer added an unsupported detail`);
    if (sample.route === 'fallback') assert(trace.simulatedFailure && /human review/i.test(answer.text), `${scenario.name}: outage did not yield a human review fallback`);
    if (sample.route === 'out_of_scope') assert(!/function|python|javascript/i.test(answer.text), `${scenario.name}: unrelated coding request was answered`);
    recorded.messages.push({ id: answer.id, question: sample.text, route: trace.actualRoute, provider: trace.provider, model: trace.model, sourceIds: trace.sourceIds, latencyMs: trace.latencyMs, answer: answer.text });
    console.log(`${scenario.name}: ${trace.actualRoute} via ${trace.provider} (${trace.latencyMs} ms)`);
  }
}

const byName = name => created.find(item => item.name === name);
const shipping = byName('Shipping timeline');
const outage = byName('Specialist outage and fallback');
const refund = byName('Refund FAQ to contract escalation');
await request('/api/feedback', 'POST', { conversationId: shipping.id, messageId: shipping.messages[0].id, rating: 'up', note: 'The shipping timeframe is clear and cites the shipping policy.' });
await request('/api/feedback', 'POST', { conversationId: outage.id, messageId: outage.messages[0].id, rating: 'down', note: 'The outage response should explicitly mention that the signed contract needs specialist review.' });
await request('/api/preferences', 'POST', {
  conversationId: outage.id,
  messageId: outage.messages[0].id,
  chosen: 'A signed contract may change how the general refund policy applies. I cannot decide which term controls automatically. Please request a support specialist to review your agreement and this conversation. Source: POL-EXCEPT-01',
  note: 'Reviewed wording for the simulated outage case.'
});
await request(`/api/conversations/${refund.id}/tickets`, 'POST', { note: 'Please compare the customer’s signed refund timeline with the general refund policy before making a decision.' });
const replay = await request(`/api/conversations/${refund.id}/replay`, 'POST', { threshold: status.threshold });
assert(replay.rows.length === 2 && replay.rows[0].replayRoute === 'local' && replay.rows[1].replayRoute === 'premium', 'Mixed-route conversation did not replay as expected.');
const feedback = await request('/api/feedback/summary');
const tickets = await request('/api/tickets');
const conversations = await request('/api/conversations');
assert(conversations.length === scenarios.length && feedback.total === 2 && feedback.preferences === 1 && tickets.length === 1, 'Seed totals do not match expected fresh dataset.');
console.log(JSON.stringify({ conversations: created, feedback: { total: feedback.total, positive: feedback.positive, negative: feedback.negative, preferences: feedback.preferences }, tickets: tickets.length, replay: replay.totals }, null, 2));
