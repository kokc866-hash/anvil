import { Agent } from 'undici';
import { initializeSystemCertificates } from './system-certificates.mjs';

function createModelAgent() {
  // The model worker has its own Node TLS state, independent of the desktop process.
  initializeSystemCertificates();
  return new Agent({ headersTimeout: 0, bodyTimeout: 0 });
}

/** Only model requests use this pool. Keep normal TLS verification, origin
 * separation and connect timeout; a slow token stream is governed by its own
 * AbortSignal/hard deadline, not a second hidden five-minute idle deadline. */
/** @type {Agent | undefined} */
let agent;
const dispatcher = {
  /** @type {import('undici').Dispatcher['dispatch']} */
  dispatch(options, handler) {
    agent ??= createModelAgent();
    // fetch versions may populate these on every dispatch. Agent constructor
    // defaults alone do not reliably disable the effective request timeout.
    return agent.dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
  },
};

/** Node-only fetch boundary; never install this dispatcher globally. Browser
 * requests and non-model services retain their existing transport behavior.
 * @type {typeof fetch} */
export const modelFetch = (input, init) => {
  const request = { ...init, dispatcher };
  return fetch(input, request);
};
