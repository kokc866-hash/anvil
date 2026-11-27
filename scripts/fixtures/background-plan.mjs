import assert from 'node:assert/strict';

/** Complete fixture steps using the receipts issued by the real worker. */
export function fixturePlanUpdates(messages, operations) {
  return operations.map(({ callId, kind, reason, step }, index) => {
    const message = messages.findLast(entry => entry.role === 'tool' && entry.tool_call_id === callId);
    assert.ok(message, `Missing tool result for ${callId}`);
    const content = String(message.content);
    const evidenceId = content.match(/(?:"plan_evidence_id"\s*:\s*"|^Plan evidence ID:\s*)(e\d+)\b/)?.[1];
    assert.ok(evidenceId, `Missing plan evidence for ${callId}`);
    return { step: step ?? index + 1, kind, status: 'ok', reason, evidence: [evidenceId] };
  });
}
