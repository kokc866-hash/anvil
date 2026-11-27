import { getRequest } from "@tanstack/react-start/server";
import { modelFetch } from "../../electron/model-http.mjs";

/** Capture one HTTP request; retries must never borrow another request's signal. */
export function requestTransport(): { signal: AbortSignal; send: typeof fetch } {
  const signal = getRequest().signal;
  const send: typeof fetch = async (input, init) => {
    signal.throwIfAborted();
    const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    combined.throwIfAborted();
    const response = await modelFetch(input, { ...init, signal: combined });
    signal.throwIfAborted();
    return response;
  };
  return { signal, send };
}
