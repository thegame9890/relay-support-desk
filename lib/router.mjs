import { retrieve } from './knowledge.mjs';

const highRisk = /\b(contract|agreement|law|legal|lawyer|sue|court|dispute|fraud|chargeback|exception|manager|threat|breach|signed|despite|expired|outside)\b/i;
const ambiguity = /\b(but|however|unless|different|contradict|special|custom|instead|despite)\b/i;
const supportContext = /\b(?:refunds?|payments?|purchases?|shipping|shipments?|delivery|deliver(?:ed|y)?|tracking|packages?|parcels?|returns?|exchanges?|cancell?ations?|cancel(?:led|ing)?|orders?|dispatch(?:ed)?|items?|products?|accounts?|subscriptions?|invoices?|bills?|charges?|checkout|contracts?|agreements?|polic(?:y|ies)|warrant(?:y|ies)|customer service|support|agents?|specialists?|managers?|complaints?|chargebacks?|disputes?|law|laws|lawyers?|legal|fraud|breach)\b/i;
const unrelatedTask = /\b(?:write|generate|create|make|show|give|provide|explain|debug|fix)\b.{0,50}\b(?:code|program|script|function|poem|story|essay|recipe|joke)\b|\b(?:python|javascript|java|algorithm|homework|equation)\b/i;

export function isOutOfScope(input) {
  // An explicit unrelated task wins even if it happens to mention a support keyword.
  return unrelatedTask.test(input) || !supportContext.test(input);
}

export function routeMessage(input, threshold = 0.72) {
  if (isOutOfScope(input)) return { route: 'out_of_scope', reason: 'Question is outside the customer support topics this desk handles', confidence: 0, threshold, sources: [], risk: false, ambiguous: false };
  const sources = retrieve(input);
  if (/\b(contract|agreement|law|legal|signed|terms|dispute)\b/i.test(input)) sources.sort((a, b) => (b.id === 'POL-EXCEPT-01') - (a.id === 'POL-EXCEPT-01') || b.score - a.score);
  const top = sources[0];
  const risk = highRisk.test(input);
  const ambiguous = ambiguity.test(input);
  const coverage = top ? Math.min(top.score / 6, 1) : 0;
  const separation = top && sources[1] ? Math.min((top.score - sources[1].score) / 5, 1) : top ? 1 : 0;
  const confidence = Number(Math.max(0, Math.min(0.98, 0.12 + coverage * 0.67 + separation * 0.16 - (ambiguous ? 0.18 : 0))).toFixed(2));
  const route = risk || confidence < threshold ? 'premium' : 'local';
  const reason = risk ? 'Sensitive or contract-related question' : !top ? 'No matching policy source' : confidence < threshold ? 'Policy match below confidence threshold' : 'Strong match to an approved policy';
  return { route, reason, confidence, threshold, sources, risk, ambiguous };
}
