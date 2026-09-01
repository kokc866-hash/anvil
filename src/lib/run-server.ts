import { createServerFn } from "@tanstack/react-start";
import { sameOriginMiddleware } from "@/lib/auth/middleware";

export type RemoteRun = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

const WANDBOX_LANG: Record<string, string> = {
  go: "Go",
  rust: "Rust",
  java: "Java",
  cpp: "C++",
  c: "C",
  typescript: "TypeScript",
  csharp: "C#",
  php: "PHP",
  ruby: "Ruby",
};

let compilers: { language: string; name: string }[] | null = null;

async function compilerFor(wandboxLang: string): Promise<string> {
  if (!compilers) {
    const res = await fetch("https://wandbox.org/api/list.json");
    if (!res.ok) throw new Error(`Compiler-Liste: HTTP ${res.status}`);
    compilers = (await res.json()) as { language: string; name: string }[];
  }
  const match = compilers.filter((c) => c.language === wandboxLang);
  const stable = match.find((c) => !c.name.includes("head") && !c.name.includes("trunk"));
  const name = (stable ?? match[0])?.name;
  if (!name) throw new Error(`Kein Compiler für ${wandboxLang}`);
  return name;
}

export const runRemote = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator(
    (input: { lang: string; entry: string; files: { path: string; content: string }[]; stdin?: string }) =>
      input,
  )
  .handler(async ({ data }): Promise<RemoteRun> => {
    const wandboxLang = WANDBOX_LANG[data.lang];
    if (!wandboxLang) {
      return { ok: false, stdout: "", stderr: `Kein Remote-Runner für ${data.lang}` };
    }
    const entry = data.files.find((f) => f.path === data.entry) ?? data.files[0];
    if (!entry) return { ok: false, stdout: "", stderr: "Keine Datei" };
    let source = entry.content;
    if (data.lang === "java") source = source.replace(/\bpublic\s+class\s+/, "class ");
    const others = data.files.filter((f) => f.path !== entry.path && f.content.length < 80_000);

    try {
      if (data.lang === "go" && others.length === 0) {
        const go = await runGoPlay(entry.content);
        if (go) return go;
      }
      if (data.lang === "rust" && others.length === 0) {
        const rust = await runRustPlay(entry.content);
        if (rust) return rust;
      }

      const compiler = await compilerFor(wandboxLang);
      const res = await fetch("https://wandbox.org/api/compile.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compiler,
          code: source,
          codes: others.map((f) => ({ file: f.path.split("/").pop(), code: f.content })),
          stdin: data.stdin ?? "",
          save: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, stdout: "", stderr: `Remote ${res.status}: ${body.slice(0, 240)}` };
      }
      const json = (await res.json()) as {
        status?: string;
        program_output?: string;
        program_error?: string;
        compiler_error?: string;
        compiler_message?: string;
      };
      const stderr = [json.compiler_error, json.compiler_message, json.program_error]
        .filter(Boolean)
        .join("\n");
      const stdout = json.program_output ?? "";
      const ok = (json.status ?? "0") === "0" && !stderr;
      return { ok, stdout, stderr };
    } catch (err) {
      return {
        ok: false,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  });

async function runGoPlay(code: string): Promise<RemoteRun | null> {
  try {
    const res = await fetch("https://play.golang.org/compile", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `version=2&body=${encodeURIComponent(code)}`,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      Errors?: string;
      Events?: { Message: string; Kind: string }[];
    };
    if (json.Errors) return { ok: false, stdout: "", stderr: json.Errors };
    let stdout = "";
    let stderr = "";
    for (const ev of json.Events ?? []) {
      if (ev.Kind === "stderr") stderr += ev.Message;
      else stdout += ev.Message;
    }
    return { ok: !stderr, stdout, stderr };
  } catch {
    return null;
  }
}

async function runRustPlay(code: string): Promise<RemoteRun | null> {
  try {
    const res = await fetch("https://play.rust-lang.org/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "stable",
        mode: "debug",
        edition: "2021",
        crateType: "bin",
        tests: false,
        code,
        backtrace: false,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success: boolean; stdout: string; stderr: string };
    const compileLog = json.success ? "" : json.stderr;
    return { ok: json.success, stdout: json.stdout ?? "", stderr: compileLog };
  } catch {
    return null;
  }
}
