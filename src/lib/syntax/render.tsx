import { clsOf, tokenize } from "./engine";
import "./grammars";

export function CodeBlock({
  code,
  lang,
  path,
}: {
  code: string;
  lang?: string;
  path?: string;
}) {
  const id = lang || (path?.split(".").pop() ?? "plaintext");
  const tokens = tokenize(code, id);
  return (
    <pre className="syntax overflow-x-auto p-2 font-mono text-xs leading-5">
      {tokens.map((t, i) => (
        <span key={i} className={clsOf(t.kind)}>
          {t.text}
        </span>
      ))}
    </pre>
  );
}
