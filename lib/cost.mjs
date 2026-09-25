export const COST_ASSUMPTIONS = Object.freeze({
  premiumUsdPerMillionTokens: 2,
  charactersPerToken: 4,
  fixedTokensPerAnswer: 120
});

const roundUsd = value => Number(value.toFixed(6));

export function summarizeCosts(conversations, assumptions = COST_ASSUMPTIONS) {
  const answers = conversations.flatMap(conversation => conversation.messages.flatMap((message, index) => {
    if (message.role !== 'assistant' || !message.trace) return [];
    const question = conversation.messages[index - 1];
    if (question?.role !== 'user') return [];
    const estimatedTokens = Math.max(30, Math.ceil((question.text.length + message.text.length) / assumptions.charactersPerToken) + assumptions.fixedTokensPerAnswer);
    return [{ estimatedTokens, apiChargeUsd: Math.max(0, Number(message.trace.estimatedCostUsd) || 0), route: message.trace.actualRoute }];
  }));
  const totalTokens = answers.reduce((sum, answer) => sum + answer.estimatedTokens, 0);
  const baselineUsd = totalTokens * assumptions.premiumUsdPerMillionTokens / 1_000_000;
  const relayUsd = answers.reduce((sum, answer) => sum + answer.apiChargeUsd, 0);
  const avoidedUsd = Math.max(0, baselineUsd - relayUsd);
  const averageAvoidedUsd = answers.length ? avoidedUsd / answers.length : 0;
  return {
    answeredQuestions: answers.length,
    routes: {
      local: answers.filter(answer => answer.route === 'local').length,
      advanced: answers.filter(answer => answer.route === 'premium').length,
      fallback: answers.filter(answer => answer.route === 'fallback').length,
      outOfScope: answers.filter(answer => answer.route === 'out_of_scope').length
    },
    baselineUsd: roundUsd(baselineUsd),
    relayApiUsd: roundUsd(relayUsd),
    avoidedApiUsd: roundUsd(avoidedUsd),
    avoidedPercent: baselineUsd ? Math.round(avoidedUsd / baselineUsd * 100) : 0,
    projectedAvoidedPer10kUsd: roundUsd(averageAvoidedUsd * 10000),
    assumptions: {
      ...assumptions,
      totalEstimatedTokens: totalTokens,
      baseline: 'One paid model answer for every recorded customer question',
      excludes: 'Local electricity, hardware, hosted router charges, and support staff time'
    }
  };
}
