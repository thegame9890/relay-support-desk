const $ = selector => document.querySelector(selector);
const state = { conversation: null, status: null, sending: false, view: 'chat', selectedTraceId: null, review: null, noteAction: null };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = value => `$${Number(value || 0).toFixed(5)}`;
const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
};
const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.add('hidden'), 3500); }

async function startConversation() {
  state.conversation = await post('/api/conversations', {});
  renderConversation();
  await loadConversations();
  showView('chat');
}
async function loadConversations() {
  const items = await api('/api/conversations');
  $('#conversationList').innerHTML = items.slice(0, 12).map(item => `<button class="recent-item ${state.conversation?.id === item.id ? 'selected' : ''}" data-id="${item.id}" title="${escapeHtml(item.preview)}">${escapeHtml(item.preview)}</button>`).join('');
}
async function openConversation(id, view = 'chat') {
  state.conversation = await api(`/api/conversations/${id}`);
  state.selectedTraceId = null;
  renderConversation();
  await loadConversations();
  showView(view);
}
function renderConversation() {
  const messages = state.conversation?.messages || [];
  const assistantMessages = messages.filter(item => item.role === 'assistant');
  $('#replayButton').disabled = assistantMessages.length === 0;
  $('#ticketButton').disabled = messages.length === 0;
  if (!messages.length) {
    $('#messages').innerHTML = `<div class="welcome"><div class="welcome-icon">✳</div><h2>How can we help?</h2><p>Ask about shipping, refunds, returns, or a more complex policy case.</p><div class="suggestions"><button data-prompt="When will my refund arrive?">When will my refund arrive? <span>↗</span></button><button data-prompt="Can I cancel my order after it ships?">Can I cancel an order? <span>↗</span></button><button data-prompt="My signed contract contradicts your refund policy.">My contract conflicts with your policy <span>↗</span></button></div></div>`;
    renderOperations();
    return;
  }
  $('#messages').innerHTML = messages.map(message => {
    if (message.role === 'user') return `<div class="message-row user"><div class="bubble">${escapeHtml(message.text)}</div></div>`;
    return `<div class="message-row assistant"><div class="message-avatar">✳</div><div><div class="bubble">${escapeHtml(message.text)}</div><div class="message-meta">Relay assistant</div><div class="response-actions"><button data-feedback="up" data-message="${message.id}" aria-label="Helpful answer">👍 Helpful</button><button data-feedback="down" data-message="${message.id}" aria-label="Unhelpful answer">👎 Needs work</button></div></div></div>`;
  }).join('');
  $('#messages').scrollTop = $('#messages').scrollHeight;
  renderOperations();
}
const routeLabel = route => route === 'premium' && state.status?.supportMode === 'free' ? 'Advanced local model' : (route || 'Unknown').replaceAll('_', ' ');
function renderLive(progress) {
  const panel = $('#operationsLive');
  panel.classList.toggle('hidden', !progress);
  if (!progress) { panel.innerHTML = ''; return; }
  panel.innerHTML = `<div class="operations-live-head"><span class="live-pulse"></span><strong>Processing now</strong><span>${escapeHtml(progress.question)}</span></div><div class="operations-live-steps">${progress.stages.map((step, index) => `<div class="operations-live-step ${index === progress.stages.length - 1 ? 'current' : ''}"><span>${index + 1}</span><div><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.detail)}</small></div></div>`).join('')}</div>`;
}
function renderOperations() {
  const messages = state.conversation?.messages || [];
  const answers = messages.filter(message => message.role === 'assistant' && message.trace);
  $('#operationsConversationLabel').textContent = state.conversation ? `Conversation ${state.conversation.id.slice(0, 8)} · ${answers.length} question${answers.length === 1 ? '' : 's'}` : 'No conversation selected';
  $('#replayButton').disabled = answers.length === 0;
  if (!answers.some(message => message.id === state.selectedTraceId)) state.selectedTraceId = answers.at(-1)?.id || null;
  $('#operationsMessages').innerHTML = answers.length ? answers.map((answer, index) => {
    const question = messages[messages.indexOf(answer) - 1]?.text || 'Customer question';
    return `<button class="operations-message ${answer.id === state.selectedTraceId ? 'selected' : ''}" data-operation-message="${answer.id}"><span class="operations-number">${String(index + 1).padStart(2, '0')}</span><span class="operations-question">${escapeHtml(question)}<small>${escapeHtml(routeLabel(answer.trace.actualRoute))} · ${new Date(answer.createdAt).toLocaleTimeString()}</small></span><span class="operations-arrow">→</span></button>`;
  }).join('') : '<div class="empty-state">Ask a question in the customer view to create a trace.</div>';
  showTrace(answers.find(message => message.id === state.selectedTraceId));
}
function showTrace(message) {
  if (!message?.trace) {
    $('#traceContent').className = 'trace-empty';
    $('#traceContent').innerHTML = '<div class="trace-illustration">⌁</div><h3>Waiting for a question</h3><p>Each completed response will show its recorded decisions here.</p>';
    return;
  }
  state.selectedTraceId = message.id;
  const t = message.trace;
  const outside = t.plannedRoute === 'out_of_scope';
  const question = state.conversation.messages[state.conversation.messages.indexOf(message) - 1]?.text || '';
  const steps = [
    ['01', 'Scope check', outside ? 'Unrelated to this support desk. The request is redirected.' : 'Customer support request accepted.', outside ? 'blocked' : 'done'],
    ['02', 'Policy retrieval', outside ? 'Skipped because this request is outside support scope.' : t.sourceIds.length ? `Matched ${t.sourceIds.join(', ')}.` : 'No approved policy matched; specialist reasoning or human review is needed.', outside ? 'skipped' : 'done'],
    ['03', 'Routing decision', outside ? 'No model call needed.' : `${t.decisionEngine || 'rules'} selected ${routeLabel(t.plannedRoute)}. ${t.reason} Routing score ${Math.round(t.confidence * 100)}%; local threshold ${Math.round(t.threshold * 100)}%.`, outside ? 'skipped' : 'done'],
    ...(t.routerFailure ? [['!', 'Router unavailable', `${t.routerFailure}. Routing rules took over.`, 'warning']] : []),
    ['04', 'Answer source', outside ? 'Deterministic support-topic redirect.' : `${t.provider} · ${t.model}`, t.failure ? 'warning' : 'done'],
    ...(t.failure ? [['!', t.simulatedFailure ? 'Simulated outage' : 'Provider failure', `${t.failure}. A deterministic fallback was returned.`, 'warning']] : []),
    ['05', 'Final response', `${routeLabel(t.actualRoute)} · ${t.latencyMs} ms · ${money(t.estimatedCostUsd)} API charge`, 'done']
  ];
  $('#traceContent').className = 'operations-trace';
  $('#traceContent').innerHTML = `<div class="operations-question-card"><small>CUSTOMER ASKED</small><p>${escapeHtml(question)}</p><span class="trace-pill ${escapeHtml(t.actualRoute)}">${escapeHtml(routeLabel(t.actualRoute))}</span></div><div class="decision-flow">${steps.map(([number, title, detail, status]) => `<div class="decision-node ${status}"><span class="decision-number">${number}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div></div>`).join('')}</div><div class="operations-answer"><small>ANSWER SHOWN TO CUSTOMER</small><p>${escapeHtml(message.text)}</p></div>`;
}
async function sendMessage(text = $('#messageInput').value) {
  const question = text.trim();
  if (!question || state.sending) return;
  if (!state.conversation) await startConversation();
  state.sending = true;
  $('#sendButton').disabled = true;
  $('#messageInput').value = '';
  $('#messages').insertAdjacentHTML('beforeend', `<div class="message-row user"><div class="bubble">${escapeHtml(question)}</div></div><div id="thinking" class="message-row assistant"><div class="message-avatar">✳</div><div class="bubble">Thinking through the best route…</div></div>`);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  try {
    const result = await post(`/api/conversations/${state.conversation.id}/messages`, { text: question, simulateOutage: $('#simulateOutage').checked });
    state.conversation.messages.push(result.userMessage, result.assistantMessage);
    state.selectedTraceId = result.assistantMessage.id;
    renderConversation();
    await loadConversations();
  } catch (error) { $('#thinking')?.remove(); toast(error.message); }
  finally { state.sending = false; $('#sendButton').disabled = false; $('#messageInput').focus(); }
}
async function submitFeedback(messageId, rating) {
  if (rating === 'down') { openNote('feedback', messageId); return; }
  try { await post('/api/feedback', { conversationId: state.conversation.id, messageId, rating, note: '' }); toast('Feedback saved for review'); }
  catch (error) { toast(error.message); }
}
async function requestTicket() {
  if (state.conversation) openNote('ticket');
}
function openNote(type, messageId = null) {
  state.noteAction = { type, messageId };
  $('#noteTitle').textContent = type === 'ticket' ? 'Request human review' : 'What should we improve?';
  $('#noteDescription').textContent = type === 'ticket' ? 'A support specialist will receive this conversation and your note.' : 'Your feedback helps a reviewer identify the problem with this answer.';
  $('#noteSubmit').textContent = type === 'ticket' ? 'Create review ticket' : 'Save feedback';
  $('#noteInput').value = '';
  $('#noteBackdrop').classList.remove('hidden');
  $('#noteInput').focus();
}
async function saveNote(event) {
  event.preventDefault();
  const action = state.noteAction;
  if (!action) return;
  try {
    if (action.type === 'ticket') {
      const ticket = await post(`/api/conversations/${state.conversation.id}/tickets`, { note: $('#noteInput').value });
      toast(`Human review requested · Ticket ${ticket.id.slice(0, 8)}`);
    } else {
      await post('/api/feedback', { conversationId: state.conversation.id, messageId: action.messageId, rating: 'down', note: $('#noteInput').value });
      toast('Feedback saved for review');
    }
    $('#noteBackdrop').classList.add('hidden');
  } catch (error) { toast(error.message); }
}
async function openReplay() {
  if (!state.conversation?.messages.length) return;
  $('#modalBackdrop').classList.remove('hidden');
  $('#threshold').value = state.status?.threshold || 0.72;
  $('#thresholdValue').textContent = Number($('#threshold').value).toFixed(2);
  await recalculateReplay();
}
async function recalculateReplay() {
  $('#replayResults').innerHTML = '<div class="empty-state">Calculating routes…</div>';
  try {
    const data = await post(`/api/conversations/${state.conversation.id}/replay`, { threshold: Number($('#threshold').value) });
    const t = data.totals;
    const free = data.comparisonMode === 'free';
    const saved = free ? (t.baselineWork ? Math.round((1 - t.dispatcherWork / t.baselineWork) * 100) : 0) : (t.baselineCostUsd ? Math.round((1 - t.dispatcherCostUsd / t.baselineCostUsd) * 100) : 0);
    const baselineTitle = free ? 'Large local model for every question' : 'Premium answers for every question';
    const baselineValue = free ? `${t.baselineWork} work units` : money(t.baselineCostUsd);
    const dispatcherValue = free ? `${t.dispatcherWork} work units` : money(t.dispatcherCostUsd);
    const callsLabel = free ? 'large-model calls' : 'premium calls';
    const callText = count => `${count} ${callsLabel.replace(/s$/, '')}${count === 1 ? '' : 's'}`;
    $('#replayResults').innerHTML = `<div class="replay-summary"><div class="replay-card"><small>${baselineTitle}</small><strong>${baselineValue}</strong><span>${callText(t.baselinePremiumCalls)} · ${t.baselineLatencyMs} ms estimated</span></div><div class="replay-card highlight"><small>Relay routes · ${saved}% less estimated ${free ? 'model work' : 'answer cost'}</small><strong>${dispatcherValue}</strong><span>${callText(t.premiumCalls)} · ${t.dispatcherLatencyMs} ms estimated</span></div></div>${free ? '<p class="replay-free-note">$0 API charges in local mode. Work units are a relative model-size estimate, not measured energy use.</p>' : ''}<table class="replay-table"><thead><tr><th>Customer question</th><th>Engine</th><th>Original</th><th>Replay route</th><th>Score</th></tr></thead><tbody>${data.rows.map(row => `<tr><td title="${escapeHtml(row.question)}">${escapeHtml(row.question)}</td><td>${escapeHtml(row.decisionEngine)}</td><td>${escapeHtml(routeLabel(row.originalRoute))}</td><td><span class="trace-pill ${escapeHtml(row.replayRoute)}">${escapeHtml(routeLabel(row.replayRoute))}</span></td><td>${Math.round(row.confidence * 100)}%</td></tr>`).join('')}</tbody></table>`;
  } catch (error) { $('#replayResults').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}
async function loadInsights() {
  const summary = await api('/api/feedback/summary');
  $('#metricCards').innerHTML = `<div class="metric-card"><small>Total ratings</small><strong>${summary.total}</strong><span>Captured from support answers</span></div><div class="metric-card"><small>Helpful</small><strong>${summary.positive}</strong><span>Positive customer signals</span></div><div class="metric-card"><small>Needs review</small><strong>${summary.negative}</strong><span>Priority improvement queue</span></div>`;
  $('#feedbackList').innerHTML = summary.recent.length ? summary.recent.map(item => `<div class="feedback-item"><span class="rating-icon">${item.rating === 'up' ? '👍' : '👎'}</span><div><strong>${item.rating === 'up' ? 'Helpful response' : 'Needs review'} · ${escapeHtml(item.route)}</strong><p>${escapeHtml(item.note || 'No additional comment')}</p><small>${new Date(item.createdAt).toLocaleString()}</small></div>${item.rating === 'down' ? `<button data-review-conversation="${item.conversationId}" data-review-message="${item.messageId}">Review answer</button>` : ''}</div>`).join('') : '<div class="empty-state">No feedback yet. Rate an answer in the support desk to start the review queue.</div>';
  const tickets = await api('/api/tickets');
  $('#ticketList').innerHTML = tickets.length ? tickets.map(ticket => `<div class="feedback-item"><span class="rating-icon">🎫</span><div><strong>Ticket ${escapeHtml(ticket.id.slice(0, 8))} · ${escapeHtml(ticket.status)}</strong><p>${escapeHtml(ticket.note || 'Conversation submitted for specialist review')}</p><small>${new Date(ticket.createdAt).toLocaleString()} · ${ticket.messageCount} messages</small></div></div>`).join('') : '<div class="empty-state">No human review requests yet.</div>';
}
async function openReview(conversationId, messageId) {
  const conversation = await api(`/api/conversations/${conversationId}`);
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 1) throw new Error('Answer not found');
  state.review = { conversationId, messageId };
  $('#reviewQuestion').textContent = conversation.messages[index - 1].text;
  $('#reviewOriginal').textContent = conversation.messages[index].text;
  $('#preferredAnswer').value = '';
  $('#reviewBackdrop').classList.remove('hidden');
  $('#preferredAnswer').focus();
}
async function saveReview(event) {
  event.preventDefault();
  if (!state.review) return;
  try {
    await post('/api/preferences', { ...state.review, chosen: $('#preferredAnswer').value });
    $('#reviewBackdrop').classList.add('hidden');
    toast('Preference pair saved');
    await loadInsights();
  } catch (error) { toast(error.message); }
}
async function loadKnowledge() {
  const docs = await api('/api/knowledge');
  $('#knowledgeList').innerHTML = docs.map(doc => `<div class="knowledge-card"><small>${escapeHtml(doc.category.toUpperCase())}</small><h2>${escapeHtml(doc.title)}</h2><p>${escapeHtml(doc.text)}</p><span>${escapeHtml(doc.id)}</span></div>`).join('');
}
function showView(view) {
  state.view = view;
  document.body.dataset.interface = view === 'chat' ? 'customer' : 'company';
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('hidden', element.id !== `${view}View`));
  document.querySelectorAll('.side-link').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  document.querySelectorAll('.interface-switch button').forEach(element => element.classList.toggle('active', element.dataset.view === (view === 'chat' ? 'chat' : 'operations')));
  $('#pageTitle').textContent = ({ chat: 'Customer support', operations: 'Decision monitor', insights: 'Insights & feedback', knowledge: 'Knowledge base' })[view];
  if (view === 'operations') renderOperations();
  if (view === 'insights') loadInsights().catch(error => toast(error.message));
  if (view === 'knowledge') loadKnowledge().catch(error => toast(error.message));
}

$('#newChat').addEventListener('click', () => startConversation().catch(error => toast(error.message)));
$('#customerNewChat').addEventListener('click', () => startConversation().catch(error => toast(error.message)));
$('#conversationList').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) openConversation(button.dataset.id, 'operations').catch(error => toast(error.message)); });
document.querySelectorAll('.side-link').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('.interface-switch button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#operationsMessages').addEventListener('click', event => { const button = event.target.closest('[data-operation-message]'); if (button) { state.selectedTraceId = button.dataset.operationMessage; renderOperations(); } });
$('#chatForm').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
$('#messageInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
$('#messages').addEventListener('click', event => {
  const prompt = event.target.closest('[data-prompt]');
  if (prompt) { $('#messageInput').value = prompt.dataset.prompt; sendMessage(); return; }
  const feedback = event.target.closest('[data-feedback]');
  if (feedback) { submitFeedback(feedback.dataset.message, feedback.dataset.feedback); feedback.classList.add('selected'); return; }
});
$('#ticketButton').addEventListener('click', requestTicket);
$('#replayButton').addEventListener('click', openReplay);
$('#modalClose').addEventListener('click', () => $('#modalBackdrop').classList.add('hidden'));
$('#modalBackdrop').addEventListener('click', event => { if (event.target.id === 'modalBackdrop') $('#modalBackdrop').classList.add('hidden'); });
$('#threshold').addEventListener('input', () => $('#thresholdValue').textContent = Number($('#threshold').value).toFixed(2));
$('#rerunReplay').addEventListener('click', recalculateReplay);
$('#feedbackList').addEventListener('click', event => { const button = event.target.closest('[data-review-message]'); if (button) openReview(button.dataset.reviewConversation, button.dataset.reviewMessage).catch(error => toast(error.message)); });
$('#reviewForm').addEventListener('submit', saveReview);
$('#reviewClose').addEventListener('click', () => $('#reviewBackdrop').classList.add('hidden'));
$('#reviewBackdrop').addEventListener('click', event => { if (event.target.id === 'reviewBackdrop') $('#reviewBackdrop').classList.add('hidden'); });
$('#noteForm').addEventListener('submit', saveNote);
$('#noteClose').addEventListener('click', () => $('#noteBackdrop').classList.add('hidden'));
$('#noteBackdrop').addEventListener('click', event => { if (event.target.id === 'noteBackdrop') $('#noteBackdrop').classList.add('hidden'); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('#modalBackdrop').classList.add('hidden'); $('#reviewBackdrop').classList.add('hidden'); $('#noteBackdrop').classList.add('hidden'); } });

async function init() {
  state.status = await api('/api/status');
  const realLocal = state.status.local.startsWith('Ollama');
  const realPremium = state.status.premium.startsWith('OpenAI');
  const answerMode = state.status.supportMode === 'free' ? (realLocal ? 'FREE LOCAL MODELS' : 'FREE DEMO MODE') : realLocal && realPremium ? 'LIVE MODELS' : realLocal || realPremium ? 'HYBRID ANSWERS' : 'DEMO ANSWERS';
  $('#modeBadge').textContent = state.status.router.startsWith('Jev') ? `● JEV ROUTER · ${answerMode}` : `● ${answerMode}`;
  await loadConversations();
  const items = await api('/api/conversations');
  if (items.length) await openConversation(items[0].id); else await startConversation();
  setInterval(async () => {
    if (state.view !== 'operations' || !state.conversation) return;
    const id = state.conversation.id;
    try {
      const progress = await api(`/api/conversations/${id}/progress`);
      if (state.view === 'operations' && state.conversation?.id === id) renderLive(progress);
      const fresh = await api(`/api/conversations/${id}`);
      if (state.view === 'operations' && state.conversation?.id === id && fresh.messages.length !== state.conversation.messages.length) {
        state.conversation = fresh;
        state.selectedTraceId = fresh.messages.filter(message => message.role === 'assistant').at(-1)?.id || null;
        renderConversation();
        await loadConversations();
      }
    } catch { /* The monitor retries on the next refresh. */ }
  }, 2000);
}
init().catch(error => toast(error.message));
