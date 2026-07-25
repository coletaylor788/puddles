/**
 * Parse JSON that may be wrapped in markdown code fences or surrounded by prose.
 * Tries a strict parse first, then strips ```json fences, then extracts the
 * first balanced {...} or [...] block. Returns undefined if nothing parses.
 */
export function parseJsonLoose(text: string | undefined | null): any {
  if (!text) return undefined;
  const s = String(text).trim();
  // 1) strict
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  // 2) strip an unlabelled or JSON code fence without a backtracking regex.
  const fenceStart = s.indexOf("```");
  if (fenceStart >= 0) {
    let contentStart = fenceStart + 3;
    const language = s.slice(contentStart, contentStart + 4);
    if (
      language.toLowerCase() === "json" &&
      /\s/.test(s[contentStart + 4] ?? "")
    ) {
      contentStart += 4;
    } else if (!/\s/.test(s[contentStart] ?? "")) {
      contentStart = -1;
    }
    while (contentStart >= 0 && /\s/.test(s[contentStart] ?? "")) {
      contentStart += 1;
    }
    const fenceEnd = contentStart >= 0 ? s.indexOf("```", contentStart) : -1;
    const fenced = fenceEnd >= 0 ? s.slice(contentStart, fenceEnd).trim() : "";
    try {
      if (fenced) {
        return JSON.parse(fenced);
      }
    } catch {
      /* fall through */
    }
  }
  // 3) first balanced object/array
  const start = s.search(/[[{]/);
  if (start >= 0) {
    const open = s[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(start, i + 1));
          } catch {
            return undefined;
          }
        }
      }
    }
  }
  return undefined;
}

/** Does `text` contain `needle`, case-insensitively? */
export function includesCI(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

/** Does `text` contain ALL of `needles`, case-insensitively? */
export function includesAllCI(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.every((n) => t.includes(n.toLowerCase()));
}

/** Does `text` contain ANY of `needles`, case-insensitively? */
export function includesAnyCI(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
}
