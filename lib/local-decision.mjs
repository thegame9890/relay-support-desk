import { routeMessage } from './router.mjs';

// A Jev-like typed choice backed by a local open-weight model.
// The source-match score remains the threshold signal; model self-confidence is not treated as calibrated.
export async function routeWithLocalDecision(question, threshold, config, fetchImpl = fetch) {
  const rules = routeMessage(question, threshold);
  if (!config.ollamaEnabled) return { ...rules, decisionEngine: 'rules (local models off)' };
  if (rules.route === 'out_of_scope' || rules.risk || !rules.sources.length) return { ...rules, decisionEngine: 'rules guardrail' };

  try {
    const response = await fetchImpl(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        format: {
          type: 'object',
          properties: { choice: { type: 'string', enum: ['local', 'advanced'] }, reason: { type: 'string' } },
          required: ['choice', 'reason']
        },
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: 'Choose a support route. Return JSON only. Choose local when the approved policy directly answers a routine FAQ. Choose advanced when there is ambiguity, an exception, missing information, or a need for judgment. Never write a customer answer.' },
          { role: 'user', content: JSON.stringify({ question, policies: rules.sources.map(({ id, title, text }) => ({ id, title, text })) }) }
        ]
      })
    });
    if (!response.ok) throw new Error(`Local router returned HTTP ${response.status}`);
    const data = await response.json();
    const choice = JSON.parse(data.message?.content || '{}');
    if (!['local', 'advanced'].includes(choice.choice) || typeof choice.reason !== 'string') throw new Error('Local router returned an invalid choice');
    const route = choice.choice === 'local' && rules.confidence >= threshold ? 'local' : 'premium';
    const reason = choice.choice === 'local' && rules.confidence < threshold ? 'Local model chose FAQ, but policy score was below threshold' : `Local model chose ${choice.choice}: ${choice.reason.slice(0, 180)}`;
    return { ...rules, route, reason, decisionEngine: 'local choice model', modelChoice: choice.choice };
  } catch (error) {
    return { ...rules, decisionEngine: 'rules fallback', routerFailure: error.message, reason: `Local router unavailable; ${rules.reason}` };
  }
}
