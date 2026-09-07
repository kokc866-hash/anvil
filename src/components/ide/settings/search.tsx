import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";

function words(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/ß/g, "ss");
}

/** Read displayed labels/hints from JSX without invoking components or inspecting input values/secrets. */
export function settingsText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(settingsText).join(" ");
  if (!isValidElement(node)) return "";
  const p = node.props as Record<string, unknown>;
  return [p.children, p.label, p.hint, p.title, p.placeholder, p["aria-label"],
    Array.isArray(p.options) ? p.options.map((o) => o?.label) : null,
  ].map((v) => settingsText(v as ReactNode)).join(" ");
}

export function matchesSettings(query: string, node: ReactNode, keywords = ""): boolean {
  const tokens = words(query).trim().split(/\s+/).filter(Boolean);
  const text = words(`${keywords} ${settingsText(node)}`);
  return tokens.every((token) => text.includes(token));
}

export function SettingsHeading({ children }: { children: ReactNode }) {
  return <p className="pt-4 pb-1 text-xs font-medium tracking-wide text-subtle uppercase">{children}</p>;
}

function filterBlocks(children: ReactNode, q: string): ReactNode[] {
  const result: ReactNode[] = [];
  let heading: ReactNode = null;
  for (const node of Children.toArray(children)) {
    if (!isValidElement(node)) continue;
    if (node.type === Fragment) {
      result.push(...filterBlocks((node.props as { children: ReactNode }).children, q));
      continue;
    }
    const p = node.props as Record<string, unknown>;
    if (node.type === SettingsHeading || ["h2", "h3", "h4"].includes(String(node.type))) {
      heading = node;
      continue;
    }
    // Nested settings components filter their own JSX and mark their own matches.
    if (typeof node.type !== "string" && "q" in p && !p.label) {
      result.push(node);
      continue;
    }
    if (!matchesSettings(q, node)) continue;
    if (heading) { result.push(heading); heading = null; }
    result.push(<div key={node.key} className="contents" data-settings-match="true">{node}</div>);
  }
  return result;
}

export function SettingsSection({ q = "", children, className }: { q?: string; children: ReactNode; className?: string }) {
  return <section className={cn(className, q && "settings-filtered")}>
    {q ? filterBlocks(children, q) : children}
  </section>;
}
