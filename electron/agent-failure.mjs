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
