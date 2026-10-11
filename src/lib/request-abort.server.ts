import { getRequest } from "@tanstack/react-start/server";

/** Capture one HTTP request; retries must never borrow another request's signal. */
export function requestTransport(): { signal: AbortSignal; send: typeof fetch } {
  const signal = getRequest().signal;
  const send: typeof fetch = async (input, init) => {
    signal.throwIfAborted();
    const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    combined.throwIfAborted();
    const response = await fetch(input, { ...init, signal: combined });
    signal.throwIfAborted();
    return response;
  };
  return { signal, send };
}
