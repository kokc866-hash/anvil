import { runRemote } from "./run-server";
import { prepareDebugTrace, parseTrace, type TraceEvent } from "./debug-trace";
export { canDebug, instrumentRemote, parseTrace, stackOf, prepareDebugTrace, type TraceEvent } from "./debug-trace";

export async function collectRemoteTrace(
  path: string,
  files: Record<string, string>,
  withLocals = true,
  signal?: AbortSignal,
): Promise<{ events: TraceEvent[]; stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  const { lang, files: pack } = prepareDebugTrace(path, files, withLocals);
  const remote = await runRemote({
    data: {
      lang,
      entry: path,
      files: pack.filter((f) => f.content.length < 80_000),
    },
    signal,
  });
  signal?.throwIfAborted();
  const parsed = parseTrace(remote.stdout, remote.stderr);
  if (!parsed.events.length && remote.stderr && withLocals) {
    return collectRemoteTrace(path, files, false, signal);
  }
  if (!parsed.events.length && remote.stderr) {
    return { events: [], stdout: parsed.stdout, stderr: parsed.stderr || remote.stderr };
  }
  return parsed;
}
