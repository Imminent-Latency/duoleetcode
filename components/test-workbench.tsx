"use client";
import { Button, TextInput, Textarea } from "./ui";
import { ActionIcon, Select, Tabs } from "@mantine/core";
import { useEffect, useId, useState } from "react";
import { CheckCircle2, LoaderCircle, Plus, X } from "lucide-react";
import type { JudgeJob, Problem } from "@/lib/types";
import {
  appendTestCase,
  submissionTestCase,
  resultCases,
  splitTestCases,
  testParameters,
} from "@/lib/test-cases";

export function TestCases({
  problem,
  value,
  onChange,
  readOnly,
  initialSelected = 0,
}: {
  problem: Problem;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  initialSelected?: number;
}) {
  const caseTabsId = useId();
  const params = testParameters(problem);
  const [cases, setCases] = useState(() =>
    splitTestCases(value, params.length),
  );
  // Keep an empty field editable instead of ejecting the user into raw mode
  // halfway through replacing its value.
  useEffect(() => {
    if (value !== cases?.flat().join("\n"))
      setCases(splitTestCases(value, params.length));
  }, [value, params.length]);
  const [selected, setSelected] = useState(initialSelected);
  const [raw, setRaw] = useState(false);
  const index = Math.min(selected, (cases?.length ?? 1) - 1);
  const update = (next: string[][]) => {
    setCases(next);
    onChange(next.flat().join("\n"));
  };
  return (
    <div className="test-case-editor">
      <div className="case-toolbar">
        <span>
          {cases
            ? `${cases.length} test ${cases.length === 1 ? "case" : "cases"}`
            : "Custom test input"}
        </span>
        <Button
          className="text-button"
          onClick={() => setRaw(!raw)}
          disabled={!cases}
        >
          {raw ? "Case view" : "Raw input"}
        </Button>
        <Button
          className="text-button"
          disabled={readOnly}
          onClick={() => {
            onChange(problem.exampleInputs.raw);
            setSelected(0);
          }}
        >
          Reset examples
        </Button>
      </div>
      {!raw && cases ? (
        <>
          <Tabs
            id={caseTabsId}
            className="duo-case-tabs"
            variant="pills"
            value={String(index)}
            onChange={(value) => setSelected(Number(value))}
          >
            <Tabs.List aria-label="Test cases">
              {cases.map((_, i) => (
                <Tabs.Tab key={i} value={String(i)}>
                  Case {i + 1}
                </Tabs.Tab>
              ))}
              <ActionIcon
                variant="subtle"
                aria-label="Add test case"
                disabled={readOnly || cases.length >= 50}
                onClick={() => {
                  update([...cases, [...cases[index]]]);
                  setSelected(cases.length);
                }}
              >
                <Plus size={15} />
              </ActionIcon>
            </Tabs.List>
          </Tabs>
          <div
            className="case-fields"
            id={`${caseTabsId}-panel-${index}`}
            aria-labelledby={`${caseTabsId}-tab-${index}`}
            role="tabpanel"
            aria-label={`Case ${index + 1} inputs`}
          >
            {params.map((p, j) => (
              <label key={j}>
                <span>
                  {p.name}
                  <small>{p.type}</small>
                </span>
                <TextInput
                  type="text"
                  aria-label={`Case ${index + 1}: ${p.name}`}
                  readOnly={readOnly}
                  value={cases[index][j]}
                  onChange={(e) =>
                    update(
                      cases.map((c, i) =>
                        i === index
                          ? c.map((v, k) => (k === j ? e.target.value : v))
                          : c,
                      ),
                    )
                  }
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
          {cases.some((c) => c.some((v) => !v.trim())) && (
            <p className="small error-text">
              Fill in each parameter before running tests.
            </p>
          )}
          <div className="case-footer">
            <span>
              Run tests checks all {cases.length} cases. Submit checks the full
              suite.
            </span>
            <Button
              className="text-button"
              disabled={readOnly || cases.length === 1}
              onClick={() => {
                update(cases.filter((_, i) => i !== index));
                setSelected(Math.max(0, index - 1));
              }}
            >
              <X size={12} /> Remove case
            </Button>
          </div>
        </>
      ) : (
        <div className="raw-test-input">
          <label htmlFor="raw-tests">
            One parameter per line, in method order
          </label>
          <Textarea
            id="raw-tests"
            aria-label="LeetCode test input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
          />
          <p className="small">
            {params.length
              ? `Each case uses ${params.map((p) => p.name).join(", ")}.`
              : "This problem uses a custom input format; the raw input is preserved."}
          </p>
          {params.length > 0 && !splitTestCases(value, params.length) && (
            <p className="small error-text">
              Use one value per parameter, with no empty lines between or after
              cases.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function JudgeResults({
  jobs,
  problem,
  testInput,
  onAddTestCase,
  testInputReadOnly = false,
}: {
  jobs: JudgeJob[];
  problem?: Problem;
  testInput?: string;
  onAddTestCase?: (input: string, index: number, existing: boolean) => void;
  testInputReadOnly?: boolean;
}) {
  const resultTabsId = useId();
  const [selected, setSelected] = useState(jobs.at(-1)?.id ?? "");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setSelected(jobs.at(-1)?.id ?? "");
    setIndex(0);
  }, [jobs.at(-1)?.id]);
  const job = jobs.find((j) => j.id === selected) ?? jobs.at(-1);
  if (!job)
    return (
      <div className="results-empty">
        <strong>Your results will appear here.</strong>
        <p>
          Choose a case to inspect its inputs, then Run tests. Submit checks
          your solution against the full LeetCode suite.
        </p>
      </div>
    );
  const params = problem ? testParameters(problem) : [];
  const cases = resultCases(job, params);
  const current = cases[Math.min(index, cases.length - 1)];
  const result = job.result;
  const failingInput = submissionTestCase(job, params.length);
  const addition =
    failingInput !== undefined && testInput !== undefined && onAddTestCase
      ? appendTestCase(testInput, failingInput, params.length)
      : undefined;
  const pending = ["sending", "judging"].includes(job.state);
  const accepted = job.summary?.verdict === "Accepted";
  const error =
    result?.full_compile_error ??
    result?.compile_error ??
    result?.full_runtime_error ??
    result?.runtime_error ??
    job.error;
  const text = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return (
    <div className="judge-results detailed-results">
      <div className="result-heading">
        <strong
          className={
            accepted
              ? "positive"
              : error || job.summary?.verdict === "Wrong Answer"
                ? "error-text"
                : ""
          }
        >
          {pending ? (
            <LoaderCircle size={16} className="spin" />
          ) : accepted ? (
            <CheckCircle2 size={16} />
          ) : null}
          {job.summary?.verdict ??
            (job.state === "unknown"
              ? "Outcome unknown"
              : job.state === "sending"
                ? "Sending to LeetCode…"
                : job.state === "judging"
                  ? "Running tests…"
                  : "No verdict returned")}
        </strong>
        <Select
          aria-label="Result history"
          value={job.id}
          allowDeselect={false}
          onChange={(value) => {
            if (value) setSelected(value);
            setIndex(0);
          }}
          data={[...jobs].reverse().map((j) => ({
            value: j.id,
            label: `${j.kind === "run" ? "Run" : "Submission"} · ${new Date(j.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          }))}
        />
      </div>
      {result && (
        <div className="result-stats">
          {result.total_testcases !== undefined && (
            <span>
              <strong>
                {String(result.total_correct ?? 0)} /{" "}
                {String(result.total_testcases)}
              </strong>{" "}
              cases passed
            </span>
          )}
          {Boolean(result.status_runtime) && (
            <span>
              <strong>{String(result.status_runtime)}</strong> runtime
            </span>
          )}
          {Boolean(result.status_memory) && (
            <span>
              <strong>{String(result.status_memory)}</strong> memory
            </span>
          )}
        </div>
      )}
      {pending && (
        <p className="small" role="status">
          Checking the saved code from this{" "}
          {job.kind === "run" ? "run" : "submission"}. You can keep editing
          while you wait.
        </p>
      )}
      {error && <pre className="judge-error">{text(error)}</pre>}
      {cases.length > 0 && (
        <>
          <Tabs
            id={resultTabsId}
            className="duo-case-tabs"
            variant="pills"
            value={String(Math.min(index, cases.length - 1))}
            onChange={(value) => setIndex(Number(value))}
          >
            <Tabs.List aria-label="Result cases">
              {cases.map((_, i) => (
                <Tabs.Tab key={i} value={String(i)}>
                  Case {i + 1}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
          <div
            className="result-case"
            id={`${resultTabsId}-panel-${Math.min(index, cases.length - 1)}`}
            aria-labelledby={`${resultTabsId}-tab-${Math.min(index, cases.length - 1)}`}
            role="tabpanel"
            aria-label={`Case ${Math.min(index, cases.length - 1) + 1} result`}
          >
            {current?.inputs && (
              <div>
                <span>Input</span>
                <pre>
                  {current.inputs
                    .map((v, i) => `${params[i].name} = ${v}`)
                    .join("\n")}
                </pre>
              </div>
            )}
            <div className="output-comparison">
              <div>
                <span>Your output</span>
                <pre>{current.actual || "(empty output)"}</pre>
              </div>
              <div>
                <span>Expected output</span>
                <pre>{current.expected ?? "Not provided by LeetCode"}</pre>
              </div>
            </div>
          </div>
        </>
      )}
      {result?.last_testcase ? (
        <div className="result-case">
          <div className="failing-case-heading">
            <span>Failing test input</span>
            {addition && (
              <Button
                className="button secondary"
                disabled={testInputReadOnly || "error" in addition}
                title={
                  "error" in addition
                    ? addition.error
                    : "Use this input with Run tests"
                }
                onClick={() => {
                  if (!("error" in addition))
                    onAddTestCase?.(
                      addition.input,
                      addition.index,
                      addition.existing,
                    );
                }}
              >
                <Plus size={14} />
                {!("error" in addition) && addition.existing
                  ? "View in test cases"
                  : "Add to test cases"}
              </Button>
            )}
          </div>
          {addition && "error" in addition && (
            <p className="small error-text">{addition.error}</p>
          )}
          <pre>{text(result.last_testcase)}</pre>
          <span>Expected output</span>
          <pre>{text(result.expected_output ?? "Not provided")}</pre>
        </div>
      ) : null}
      {result?.std_output ? (
        <details className="result-details" open>
          <summary>Console output</summary>
          <pre>{text(result.std_output)}</pre>
        </details>
      ) : null}
      {job.state === "unknown" && (
        <p className="small">
          This request won’t be sent again automatically. Recovery checks the
          original request.
        </p>
      )}
      {job.sourceVerification && (
        <p className="small">
          {job.sourceVerification.matches &&
          job.sourceVerification.questionMatches
            ? "Stored submission source verified"
            : "Source verification did not match"}
        </p>
      )}
      <details className="result-details">
        <summary>
          Code used for this {job.kind === "run" ? "run" : "submission"}
        </summary>
        <pre>{job.source}</pre>
      </details>
      {job.url && (
        <a href={job.url} target="_blank" rel="noreferrer">
          View submission on LeetCode ↗
        </a>
      )}
    </div>
  );
}
