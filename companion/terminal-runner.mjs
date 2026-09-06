/** Runs inside an OS console. Program input/output inherit real console handles. */
import { openSync, readFileSync, writeSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";

let input, output;
try {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
  input = openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
  output = openSync(process.platform === "win32" ? "CONOUT$" : "/dev/tty", "w");
  const child = spawn(job.file, job.args, { cwd: job.cwd, env: process.env, shell: false, windowsHide: false, stdio: [input, output, "pipe"] });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    try { writeSync(output, chunk); } catch { /* Console may have been closed. */ }
  });
  child.once("error", (err) => { process.stderr.write(`Terminal: ${err.message}\n`); process.exitCode = 1; });
  child.once("close", (code) => {
    closeSync(input); closeSync(output);
    process.exitCode = code ?? 1;
  });
} catch (err) {
  process.stderr.write(`Terminal konnte nicht geöffnet werden: ${err.message}\n`);
  process.exitCode = 1;
}
