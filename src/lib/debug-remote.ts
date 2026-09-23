import { runRemote } from "./run-server";
import { prepareDebugTrace, parseTrace, type TraceEvent } from "./debug-trace";
export { canDebug, instrumentRemote, parseTrace, stackOf, prepareDebugTrace, type TraceEvent } from "./debug-trace";

export async function collectRemoteTrace(
  path: string,
  files: Record<string, string>,
  withLocals = true,
): Promise<{ events: TraceEvent[]; stdout: string; stderr: string }> {
  const { lang, files: pack } = prepareDebugTrace(path, files, withLocals);
  const remote = await runRemote({
    data: {
      lang,
      entry: path,
      files: pack.filter((f) => f.content.length < 80_000),
    },
  });
  const parsed = parseTrace(remote.stdout, remote.stderr);
  if (!parsed.events.length && remote.stderr && withLocals) {
    return collectRemoteTrace(path, files, false);
  }
  if (!parsed.events.length && remote.stderr) {
    return { events: [], stdout: parsed.stdout, stderr: parsed.stderr || remote.stderr };
  }
  return parsed;
}
