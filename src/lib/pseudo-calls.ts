// A model sometimes answers with a tool call written as text: "[[open-url: https://…]]" or
// 'open_url("https://…")' (QA 0.2.11, "open it" after a mail search). Nexy acts on one marker,
// [[take-control: …]]; any other is dropped, as is a line that is only a snake_case call.
// Code blocks are left as they are.
const MARK = /[ \t]*\[\[(?!take-control:)[a-z][\w-]*:[^\]\n]*(?:\]\]|$)/gim;
const CALL = /^[ \t]*`?[a-z][a-z0-9]*(?:_[a-z0-9]+)+\((?:[^()\n]|\([^()\n]*\))*\)`?[ \t;]*(?:\n|$)/gim;

export function dropPseudoCalls(text: string): string {
  const out = text.split("```").map((part, i) => (i % 2 ? part : part.replace(MARK, "").replace(CALL, ""))).join("```");
  return out === text ? text : out.replace(/\n{3,}/g, "\n\n").trim();
}
