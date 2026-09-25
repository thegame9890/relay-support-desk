import { routeMessage } from './router.mjs';

// Jev makes a typed routing decision. Policy and safety gates stay in our service.
export async function routeWithJev(question, threshold, config, fetchImpl = fetch) {
  const rules = routeMessage(question, threshold);
  if (!config.jevKey) return { ...rules, decisionEngine: 'rules' };
  if (rules.route === 'out_of_scope' || rules.risk || !rules.sources.length) return { ...rules, decisionEngine: 'rules guardrail' };

  try {
    const response = await fetchImpl(config.jevEndpoint || 'https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.jevKey}` },
      body: JSON.stringify({
        model: config.jevModel || 'jev-latest',
        state: {
          customer_message: question,
          approved_policy_candidates: rules.sources.map(({ id, title, text }) => ({ id, title, text }))
        },
        questions: {
          route: {
            type: 'choice',
            instructions: 'Should this customer message be answered from the approved policy candidates by the local FAQ model, or escalated to a premium reasoning model? Choose premium when the policy is insufficient, ambiguous, or the case requires judgment. Choose local only when a candidate directly resolves the question.',
            criteria: {
              local: 'Routine FAQ with a direct answer in an approved policy candidate.',
              premium: 'Ambiguous, complex, account-specific, conflicting, or insufficient policy evidence.'
            }
          }
        }
      })
    });
    if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}`);
    const data = await response.json();
    const answer = data.answers?.route;
    const localProbability = answer?.probabilities?.local;
    if (answer?.type !== 'choice' || !['local', 'premium'].includes(answer.choice) || !Number.isFinite(localProbability) || localProbability < 0 || localProbability > 1) throw new Error('Jev returned an invalid routing decision');
    const confidence = Number(localProbability.toFixed(3));
    const route = answer.choice === 'local' && confidence >= threshold ? 'local' : 'premium';
    const reason = answer.choice === 'local' && confidence < threshold
      ? 'Jev chose local, but its probability was below the threshold'
      : `Jev selected ${answer.choice} with ${Math.round(confidence * 100)}% local suitability`;
    return {
      ...rules, route, reason, confidence, localProbability: confidence,
      decisionEngine: 'Jev', jevConfidence: answer.confidence ?? null,
      jevModel: data.model || config.jevModel || 'jev-latest', jevUsage: data.usage || null
    };
  } catch (error) {
    return { ...rules, decisionEngine: 'rules fallback', routerFailure: error.message, reason: `Jev unavailable; ${rules.reason}` };
  }
}

export function replayDecision(question, threshold, originalTrace) {
  const rules = routeMessage(question, threshold);
  if (rules.route === 'out_of_scope') return { ...rules, decisionEngine: 'rules guardrail' };
  if (originalTrace?.decisionEngine === 'local choice model' && ['local', 'advanced'].includes(originalTrace.modelChoice)) {
    const local = !rules.risk && rules.sources.length > 0 && originalTrace.modelChoice === 'local' && rules.confidence >= threshold;
    return { ...rules, route: local ? 'local' : 'premium', decisionEngine: 'local choice saved decision' };
  }
  if (originalTrace?.decisionEngine === 'Jev' && Number.isFinite(originalTrace.localProbability)) {
    const local = !rules.risk && rules.sources.length > 0 && originalTrace.localProbability >= threshold;
    return { ...rules, route: local ? 'local' : 'premium', confidence: originalTrace.localProbability, decisionEngine: 'Jev saved decision' };
  }
  return { ...rules, decisionEngine: 'rules' };
}
