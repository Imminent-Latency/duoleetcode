// javacs supplies qualified class names but does not attach import edits.
// This adapter handles the single-file Java workspace; it never guesses a type.
export function maskJavaNonCode(source: string) {
  return source.replace(
    /"""[\s\S]*?(?:"""|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)/g,
    (s) => s.replace(/[^\r\n]/g, " "),
  );
}

export function importForCompletion(
  source: string,
  qualified: string,
  line: number,
): { offset: number; text: string } | undefined {
  if (
    !/^(?:java|javax)\.(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*$/.test(
      qualified,
    ) ||
    qualified.startsWith("java.lang.")
  )
    return;
  const masked = maskJavaNonCode(source);
  if (/^\s*(?:import|package)\b/.test(masked.split(/\r?\n/)[line] ?? ""))
    return;
  const packageName = qualified.slice(0, qualified.lastIndexOf("."));
  const simple = qualified.slice(qualified.lastIndexOf(".") + 1);
  const imports = [
    ...masked.matchAll(/^\s*import\s+([^;\r\n]+);[^\r\n]*(?:\r?\n|$)/gm),
  ];
  if (
    imports.some((m) => [qualified, packageName + ".*"].includes(m[1].trim()))
  )
    return;
  if (imports.some((m) => m[1].trim().endsWith("." + simple))) return;
  const packageMatch = /^\s*package\s+([\w.]+);[^\r\n]*(?:\r?\n|$)/m.exec(
    masked,
  );
  if (packageMatch?.[1] === packageName) return;
  const last = imports.at(-1) ?? packageMatch;
  const offset = last ? (last.index ?? 0) + last[0].length : 0;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return {
    offset,
    text:
      (offset && source[offset - 1] !== "\n" ? eol : "") +
      `import ${qualified};${eol}`,
  };
}

// Expose only compiler-proposed imports. Reuse our insertion logic to keep
// comments, CRLF, existing imports and conflicting names intact; never run
// arbitrary server commands or apply edits to another file.
export function importQuickFixes(
  source: string,
  actions: unknown,
  line: number,
) {
  if (!Array.isArray(actions)) return [];
  const seen = new Set<string>();
  return actions.flatMap((action) => {
    const match =
      typeof action?.title === "string"
        ? /^Import '((?:java|javax)\.[\w$.]+)'$/.exec(action.title)
        : null;
    if (!match || seen.has(match[1])) return [];
    const changes = action.edit?.changes;
    const edits = changes?.["file:///files/project/Solution.java"];
    if (
      !changes ||
      Object.keys(changes).length !== 1 ||
      !Array.isArray(edits) ||
      edits.length !== 1 ||
      edits[0]?.newText?.trim() !== `import ${match[1]};`
    )
      return [];
    const edit = importForCompletion(source, match[1], line);
    if (!edit) return [];
    seen.add(match[1]);
    return [{ title: action.title as string, ...edit }];
  });
}
