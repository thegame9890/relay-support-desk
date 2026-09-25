export const knowledge = [
  { id: 'POL-REFUND-01', title: 'Refund timing', category: 'Refunds', text: 'Approved refunds return to the original payment method within 5–10 business days. The customer receives an email when the refund is issued.', keywords: ['refund', 'money', 'payment', 'back', 'days', 'when'] },
  { id: 'POL-SHIP-01', title: 'Shipping and tracking', category: 'Shipping', text: 'Standard shipping usually takes 3–5 business days after dispatch. A tracking link is emailed when the order ships.', keywords: ['shipping', 'delivery', 'tracking', 'order', 'ship', 'arrive'] },
  { id: 'POL-RETURN-01', title: 'Return window', category: 'Returns', text: 'Unused items may be returned within 30 days of delivery. The customer should include the order number when requesting a return.', keywords: ['return', 'item', '30', 'days', 'unused', 'exchange'] },
  { id: 'POL-CANCEL-01', title: 'Cancellation', category: 'Orders', text: 'Orders can be cancelled before dispatch. After dispatch, the customer may request a return under the return policy.', keywords: ['cancel', 'order', 'dispatch', 'stop'] },
  { id: 'POL-EXCEPT-01', title: 'Exceptions and agreements', category: 'Escalations', text: 'If a signed agreement, local law, or account-specific terms conflict with a general policy, a support specialist must review the case. The automated desk must not make a final determination.', keywords: ['contract', 'agreement', 'legal', 'law', 'exception', 'dispute', 'signed', 'terms'] }
];

const words = value => (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length > 2);

export function retrieve(query, limit = 3) {
  const queryWords = new Set(words(query));
  return knowledge.map(doc => {
    const keywordHits = doc.keywords.filter(keyword => queryWords.has(keyword)).length;
    const titleHits = words(doc.title).filter(word => queryWords.has(word)).length;
    const bodyHits = words(doc.text).filter(word => queryWords.has(word)).length;
    return { ...doc, score: keywordHits * 3 + titleHits * 2 + bodyHits * 0.2 };
  }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
