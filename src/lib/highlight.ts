import type { LangId } from "./languages";
import { tokenize as syn, type SyntaxToken } from "./syntax";

export type Token = { text: string; cls: string };

const KIND_CLS: Record<string, string> = {
  kw: "tok-kw",
  type: "tok-type",
  fn: "tok-fn",
  string: "tok-string",
  comment: "tok-comment",
  num: "tok-num",
  op: "tok-op",
  punct: "tok-punct",
  attr: "tok-attr",
  tag: "tok-tag",
  macro: "tok-macro",
  text: "tok-text",
};

export function tokenize(code: string, lang: LangId | string): Token[] {
  return syn(code, lang).map((t: SyntaxToken) => ({
    text: t.text,
    cls: KIND_CLS[t.kind] ?? "tok-text",
  }));
}
