/** An explicit expectation is checked against process metadata, never stderr text.
 * @param {Record<string, unknown>} result
 * @param {number | undefined} [expected]
 */
export function verifyExpectedExit(result, expected) {
  if (expected === undefined) return result;
  if (!Number.isInteger(expected) || expected < 0 || expected > 255) return { ...result, ok: false, error: 'expected_exit_code must be an integer from 0 to 255.' };
  const valid = Number.isInteger(result?.code) && !result.error && !result.isError && !result.aborted && !result.timedOut && !result.running && !result.signal;
  const ok = Boolean(valid && result.code === expected);
  return { ...result, ok, expectedExitCode: expected, exitExpectationMatched: ok,
    ...(!valid ? { error: result?.error || 'Exitcode-Erwartung konnte nicht an einem regulär beendeten Prozess geprüft werden.' } : {}),
    note: [result?.note, ok ? `Erwarteter Exitcode ${expected} bestätigt.` : `Erwarteter Exitcode ${expected} nicht bestätigt.`].filter(Boolean).join(' ') };
}
