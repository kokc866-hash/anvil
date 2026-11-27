/** @typedef {{phase: 'connect'|'http-body'|'response'|'stream', attempt: number, status?: number}} TransportFailure */
/** @typedef {{name: string, message: string, code?: string|number, cause?: FailureError}} FailureError */
/** @typedef {{phase: string, requestSequence: number, requestId?: string, transport?: TransportFailure, error: FailureError}} AgentFailure */
/** @typedef {{phase?: unknown, requestSequence?: unknown, jobId?: unknown, transport?: unknown, secrets?: string[]}} FailureContext */

/** Context is out of band: retain the original SyntaxError/TimeoutError and
 * native network cause without attaching request payloads or credentials. */
const transports = new WeakMap();

/** @param {unknown} value @returns {Record<string, unknown>} */
const record = value => value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};

/** @param {unknown} value @returns {TransportFailure|undefined} */
function transportContext(value) {
  const data = record(value);
  if (!['connect','http-body','response','stream'].includes(String(data.phase)) || !Number.isSafeInteger(data.attempt) || Number(data.attempt) < 1 || Number(data.attempt) > 8) return;
  return { phase: /** @type {TransportFailure['phase']} */ (data.phase), attempt: Number(data.attempt),
    ...(Number.isInteger(data.status) && Number(data.status) >= 100 && Number(data.status) <= 599 ? { status: Number(data.status) } : {}) };
}

/** @param {unknown} error @param {TransportFailure} context */
export function withModelFailureContext(error, context) {
  const failure = error && typeof error === 'object' ? error : new Error(String(error));
  const transport = transportContext(context);
  if (transport) transports.set(failure, transport);
  return failure;
}

/** Continue only before a response was consumed; never replay a partial stream.
 * Native fetch reports its useful socket code in cause, not in the message.
 * @param {unknown} error @returns {boolean} */
export function isRecoverableModelFailure(error) {
  const transport = error && typeof error === 'object' ? transports.get(error) : undefined;
  if (transport && transport.phase !== 'connect') return false;
  const seen = new Set(), codes = [], messages = [];
  let current = error;
  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    seen.add(current);
    const value = record(current);
    if (['AbortError', 'TimeoutError', 'SyntaxError', 'ReasoningRepetitionError'].includes(String(value.name)) || value.code === 'reasoning_repetition') return false;
    if (['ABORT_ERR', 'ERR_ABORTED', 'UND_ERR_ABORTED'].includes(String(value.code))) return false;
    if (value.code !== undefined) codes.push(String(value.code));
    messages.push(String(value.message ?? (typeof current === 'string' ? current : '')).slice(0, 1000));
    current = value.cause;
  }
  if (codes.length) return codes.some(code => /^(?:ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/.test(code));
  // Keep the existing bounded recovery for unannotated empty/stalled replies.
  return /fetch failed|failed to fetch|network|ECONNRESET|stall|leer|hang/i.test(messages.join('\n'));
}

/** User-facing explanation, kept separate from the original native error and
 * its bounded diagnostic record. This never authorizes replay or recovery.
 * @param {unknown} error @returns {string} */
export function modelFailureMessage(error) {
  const codes = new Set(), seen = new Set();
  let current = error;
  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    seen.add(current);
    const value = record(current);
    if (value.name === 'AbortError') return typeof value.message === 'string' ? value.message : 'Modellanfrage abgebrochen.';
    if (value.name === 'TimeoutError') return 'Das eingestellte Zeitlimit für die Modellanfrage wurde erreicht.';
    if (value.code !== undefined) codes.add(String(value.code));
    current = value.cause;
  }
  const continuation = ' Eine Teilantwort wird nicht automatisch wiederholt.';
  if (codes.has('UND_ERR_BODY_TIMEOUT')) return 'Die Modellverbindung wurde nach einer langen Antwortpause durch ein Empfangszeitlimit beendet.' + continuation;
  if (codes.has('UND_ERR_HEADERS_TIMEOUT')) return 'Beim Warten auf den Beginn der Modellantwort wurde ein Zeitlimit erreicht.' + continuation;
  const transport = error && typeof error === 'object' ? transports.get(error) : undefined;
  if (['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].some(code => codes.has(code)) || record(error).message === 'terminated') {
    return transport?.phase === 'connect'
      ? 'Die Verbindung zum Modell wurde vor Beginn der Antwort unterbrochen.'
      : 'Die Modellverbindung wurde während der Antwort unterbrochen.' + continuation;
  }
  return typeof record(error).message === 'string' ? String(record(error).message) : String(error);
}

/** @param {string} text @param {string[]} secrets */
function redact(text, secrets) {
  for (const secret of secrets.filter(Boolean)) {
    text = text.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]');
  }
  return text
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, raw => {
      try { const url = new URL(raw); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); } catch { return '[redacted URL]'; }
    })
    .replace(/\b(Bearer|Basic)\s+[\w.+/=:-]+/gi, '$1 [redacted]')
    .replace(/(["']?\b(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\p{Cc}/gu, ' ');
}

/** Bounded allowlist; stacks, headers, bodies and arbitrary error properties
 * never enter the durable diagnostic record. @param {unknown} error
 * @param {FailureContext} [context] @returns {AgentFailure} */
export function captureAgentFailure(error, context = {}) {
  const secrets = (context.secrets || []).filter(value => typeof value === 'string' && value.length > 0);
  const seen = new Set();
  /** @param {unknown} value @param {number} depth @returns {FailureError} */
  const describe = (value, depth) => {
    const data = record(value);
    const rawName = redact(typeof data.name === 'string' ? data.name : 'Error', secrets);
    const name = /^[\w.-]{1,64}$/.test(rawName) ? rawName : 'Error';
    const message = redact(typeof data.message === 'string' ? data.message : typeof value === 'string' ? value : 'Auftrag fehlgeschlagen.', secrets).slice(0, 1000);
    const rawCode = typeof data.code === 'string' ? redact(data.code, secrets) : data.code;
    const code = typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode
      : typeof rawCode === 'string' && /^[\w.-]{1,64}$/.test(rawCode) ? rawCode : undefined;
    seen.add(value);
    const cause = data.cause !== undefined && depth < 3 && !seen.has(data.cause) ? describe(data.cause, depth + 1) : undefined;
    return { name, message, ...(code !== undefined ? { code } : {}), ...(cause ? { cause } : {}) };
  };
  const phase = ['preparing','waiting','thinking','answering','tool'].includes(String(context.phase)) ? String(context.phase) : 'preparing';
  const requestSequence = Number.isSafeInteger(context.requestSequence) && Number(context.requestSequence) >= 0 ? Number(context.requestSequence) : 0;
  const jobId = typeof context.jobId === 'string' && /^[\w-]{1,80}$/.test(context.jobId) ? context.jobId : '';
  const transport = transportContext(context.transport) || (error && typeof error === 'object' ? transports.get(error) : undefined);
  return { phase, requestSequence, ...(jobId && requestSequence ? { requestId: `${jobId}:model:${requestSequence}` } : {}),
    ...(transport ? { transport } : {}), error: describe(error, 0) };
}
