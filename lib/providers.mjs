const timeout = (ms = 15000) => AbortSignal.timeout(ms);
const context = sources => sources.map(source => `[${source.id}] ${source.title}: ${source.text}`).join('\n');

export function deterministicAnswer(source) {
  if (!source || source.category === 'Escalations') return null;
  return `${source.text}\n\nSource: ${source.id}`;
}

export function outOfScopeAnswer() {
  return 'I can help with orders, shipping, returns, refunds, and related policy questions. Please ask me about one of those topics.';
}

export async function localAnswer(question, sources, config, fetchImpl = fetch) {
  if (!config.ollamaEnabled) return { text: deterministicAnswer(sources[0]), provider: 'demo policy answer', model: 'verified policy' };
  const messages = [
    { role: 'system', content: `You are a customer support desk for orders, shipping, returns, refunds, and related policies. If the request is unrelated to customer support, briefly redirect to those topics without answering the unrelated request. Otherwise answer using only these approved policies. State only facts explicitly present in the policy; do not add extra steps, conditions, or delivery details. If the policy does not answer a support question, say that a support specialist must review it. Keep the answer concise and end with the exact policy ID: ${sources[0]?.id || 'none'}.\n${context(sources)}` },
    { role: 'user', content: question }
  ];
  const ask = async current => {
    const response = await fetchImpl(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: timeout(),
      body: JSON.stringify({ model: config.ollamaModel, stream: false, options: { temperature: 0 }, messages: current })
    });
    if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data.message?.content) throw new Error('Local model returned no answer');
    return data.message.content.trim();
  };
  let answer = await ask(messages);
  if (!sources.some(source => answer.includes(source.id))) {
    answer = await ask([...messages, { role: 'assistant', content: answer }, { role: 'user', content: `Rewrite your answer using only the supplied policy and include the exact source ID ${sources[0]?.id}.` }]);
  }
  if (!sources.some(source => answer.includes(source.id))) throw new Error('Local answer did not cite an approved source');
  return { text: answer, provider: 'Ollama', model: config.ollamaModel };
}

export async function advancedLocalAnswer(question, sources, config) {
  if (!config.ollamaEnabled) return { text: demoPremiumAnswer(question, sources), provider: 'demo advanced simulation', model: 'guided example' };
  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: timeout(30000),
    body: JSON.stringify({ model: config.ollamaAdvancedModel, stream: false, messages: [
      { role: 'system', content: `You are a customer support specialist for orders, shipping, returns, refunds, and related policies. If a request is unrelated to customer support, briefly redirect to those topics without answering it. Use only the approved policies below. Do not infer rules or capabilities from a policy on a related topic. If no policy directly covers the requested action, say that the approved policies do not specify it and offer human review. For contracts, disputes, account-specific terms, or missing policy evidence, do not make a final determination. Explain what needs review and offer human handoff. Cite a policy ID only when using its text. Keep the answer concise.\n${context(sources)}` },
      { role: 'user', content: question }
    ] })
  });
  if (!response.ok) throw new Error(`Advanced local model returned HTTP ${response.status}`);
  const data = await response.json();
  if (!data.message?.content) throw new Error('Advanced local model returned no answer');
  return { text: data.message.content.trim(), provider: 'Ollama advanced', model: config.ollamaAdvancedModel };
}

export async function premiumAnswer(question, sources, config) {
  if (!config.premiumEnabled) return { text: demoPremiumAnswer(question, sources), provider: 'demo premium simulation', model: 'guided example' };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal: timeout(),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openaiKey}` },
    body: JSON.stringify({ model: config.openaiModel, temperature: 0.2, messages: [
      { role: 'system', content: `You are a customer support specialist for orders, shipping, returns, refunds, and related policies. If a request is unrelated to customer support, briefly redirect to those topics without answering it. Use only approved policy excerpts below. Do not infer rules or capabilities from a policy on a related topic. If no policy directly covers the requested action, say that the approved policies do not specify it and offer human review. For conflicting contracts, legal issues, or missing facts, do not make a final determination; explain what must be reviewed and offer human handoff. Cite relevant policy IDs when using a policy.\n${context(sources)}` },
      { role: 'user', content: question }
    ] })
  });
  if (!response.ok) throw new Error(`Premium API returned HTTP ${response.status}`);
  const data = await response.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('Premium API returned no answer');
  return { text: data.choices[0].message.content.trim(), provider: 'OpenAI', model: config.openaiModel, usage: data.usage || null };
}

function demoPremiumAnswer(question, sources) {
  const top = sources[0];
  if (/contract|agreement|legal|signed|dispute/i.test(question)) return 'I can see why this needs a closer look. A signed agreement or account-specific term may change how the general policy applies. I cannot make a final decision here, so I can send this conversation to a support specialist for review. Source: POL-EXCEPT-01';
  if (!top) return 'I could not find an approved policy that resolves this question. I can send it to a support specialist for review.';
  return `${top.text}\n\nIf your situation differs from this general policy, I can request a specialist review. Source: ${top.id}`;
}

export function fallbackAnswer(source) {
  const verified = deterministicAnswer(source);
  if (verified) return `${verified}\n\nThe specialist service is temporarily unavailable. If this policy does not cover your case, request a human review.`;
  return 'The specialist service is temporarily unavailable. I cannot safely resolve this case from the general policy. Please request a human review; your conversation will be included.';
}
