// A tiny way to write bold words inside a translated sentence once, and use the sentence in
// both the HTML and the plain-text version of an email (and on a web page).
//
//   m.email.instructions.intro(first, b(childNames), weeks, b(payBy))
//
// b() wraps a value in two private-use characters. renderRich() escapes everything else, then
// turns the markers into <strong>…</strong> (html) or removes them (text). The words being
// bolded are whatever the caller passes, so nothing from a family's form can add markup.

const START = "";
const END = "";

export const b = (value: string): string => `${START}${value}${END}`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderRichHtml(text: string): string {
  return escapeHtml(text).replaceAll(START, "<strong>").replaceAll(END, "</strong>");
}

export function renderRichText(text: string): string {
  return text.replaceAll(START, "").replaceAll(END, "");
}

// For React: split into plain and bold parts.
export function richParts(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  let bold = false;
  let current = "";
  for (const ch of text) {
    if (ch === START || ch === END) {
      if (current) parts.push({ text: current, bold });
      current = "";
      bold = ch === START;
    } else {
      current += ch;
    }
  }
  if (current) parts.push({ text: current, bold });
  return parts;
}
