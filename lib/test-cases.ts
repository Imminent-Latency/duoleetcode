import type { Problem, JudgeJob } from "./types";
export type Parameter = { name: string; type: string };
function splitTopLevelParams(paramsText: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < paramsText.length; i++) {
    const c = paramsText[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    if (c === ">" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      parts.push(paramsText.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(paramsText.slice(start));
  return parts;
}

export function testParameters(problem: Problem): Parameter[] {
  if (problem.metadata?.systemdesign) return [];
  if (problem.metadata?.params?.length) return problem.metadata.params;
  // Legacy saved attempts lack metadata. Only fall back to a simple public
  // method signature; unsupported designs keep the raw-input editor.
  const javaSig = problem.javaStarter?.trim()
    ? /public\s+(?:static\s+)?[\w<>?,.\[\] ]+\s+\w+\s*\(([^)]*)\)/.exec(
        problem.javaStarter,
      )
    : null;
  if (javaSig?.[1]?.trim()) {
    const params = splitTopLevelParams(javaSig[1]).map((p) =>
      /^\s*(.+?)\s+([\w$]+)\s*$/.exec(p),
    );
    return params.every(Boolean)
      ? params.map((p) => ({ type: p![1].trim(), name: p![2] }))
      : [];
  }
  const cppSource = problem.cppStarter
    ?.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  if (!cppSource?.trim()) return [];
  const cppClass = /class\s+Solution\b[\s\S]*?public\s*:([\s\S]*)/.exec(
    cppSource,
  );
  const cppBody = cppClass?.[1] ?? cppSource;
  const cppSig =
    /(?:^|\n)\s*(?:virtual\s+|static\s+|inline\s+|constexpr\s+)*[\w:<> *&]+\s+[\w~]+\s*\(([^)]*)\)/.exec(
      cppBody,
    );
  if (!cppSig?.[1]?.trim()) return [];
  const cppParams = splitTopLevelParams(cppSig[1]).map((p) =>
    /^\s*(.+?[*&\s])\s*([A-Za-z_]\w*)\s*(?:=\s*[^,]+)?$/.exec(p),
  );
  return cppParams.every(Boolean)
    ? cppParams.map((p) => ({ type: p![1].trim(), name: p![2] }))
    : [];
}
export function splitTestCases(
  raw: string,
  count: number,
): string[][] | undefined {
  const lines = raw.split(/\r?\n/);
  if (
    !raw.trim() ||
    !count ||
    lines.length % count ||
    lines.some((l) => !l.trim())
  )
    return;
  return Array.from({ length: lines.length / count }, (_, i) =>
    lines.slice(i * count, (i + 1) * count),
  );
}
export function resultCases(job: JudgeJob, params: Parameter[]) {
  if (job.kind !== "run" || !Array.isArray(job.result?.code_answer)) return [];
  const actual = job.result.code_answer as unknown[];
  const expected = Array.isArray(job.result.expected_code_answer)
    ? job.result.expected_code_answer
    : [];
  const count =
    typeof job.result.total_testcases === "number"
      ? job.result.total_testcases
      : actual.length;
  const inputs = splitTestCases(job.input ?? "", params.length);
  return actual.slice(0, count).map((value, i) => ({
    actual: typeof value === "string" ? value : JSON.stringify(value),
    expected:
      expected[i] === undefined
        ? undefined
        : typeof expected[i] === "string"
          ? (expected[i] as string)
          : JSON.stringify(expected[i]),
    inputs: inputs?.[i],
  }));
}

// Only offer runnable input actually returned by the judge, never hidden or
// truncated display text. Preserve numeric precision and quoted string values.
export function submissionTestCase(job: JudgeJob, parameterCount: number) {
  if (
    job.kind !== "submit" ||
    job.state !== "complete" ||
    job.summary?.verdict === "Accepted" ||
    job.result?.status_code === 10 ||
    typeof job.result?.last_testcase !== "string"
  )
    return;
  const raw = job.result.last_testcase.replace(/\r\n/g, "\n").trim();
  const lines = raw.split("\n");
  if (!raw || (parameterCount && lines.length !== parameterCount)) return;
  try {
    for (const line of lines) JSON.parse(line);
  } catch {
    return;
  }
  return raw;
}

export function appendTestCase(
  current: string,
  incoming: string,
  parameterCount: number,
): { input: string; index: number; existing: boolean } | { error: string } {
  const raw = current.replace(/\r\n/g, "\n").trim();
  const cases = raw ? splitTestCases(raw, parameterCount) : [];
  if (parameterCount && !cases)
    return {
      error:
        "Finish or fix the current test inputs before adding another case.",
    };
  const key = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  const index = parameterCount
    ? cases!.findIndex((value) => key(value.join("\n")) === key(incoming))
    : raw === incoming
      ? 0
      : -1;
  if (index >= 0) return { input: current, index, existing: true };
  if (cases && cases.length >= 50)
    return { error: "Remove a test case before adding another (50 maximum)." };
  const input = raw ? raw + "\n" + incoming : incoming;
  if (input.length > 100_000)
    return { error: "This case would exceed the test input size limit." };
  return { input, index: cases?.length ?? 0, existing: false };
}
