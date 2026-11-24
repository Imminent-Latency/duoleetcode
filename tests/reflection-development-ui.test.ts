import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  ApproachContext,
  DevelopmentSummary,
} from "../components/reflection-development";
import {
  reflectionFixture,
  developmentFixture,
} from "../tools/reflection-fixture";

test("linked help shows active-time timestamps and only delivered answers beside replay controls", () => {
  const a = reflectionFixture(),
    d = developmentFixture();
  a.pauses = [{ start: a.createdAt + 2000, end: a.createdAt + 62000 }];
  a.javaHelp = [
    {
      id: "help",
      question: "How does a comparator work?",
      requestSeq: 2,
      responseSeq: 3,
      askedAt: a.createdAt + 70000,
      deliveredAt: a.createdAt + 80000,
      state: "ready",
      answer: "Use the record component.",
    },
    {
      id: "pending",
      question: "Unanswered question",
      requestSeq: 4,
      askedAt: a.createdAt + 90000,
      state: "failed",
    },
  ];
  d.approaches[0].assistanceIds = ["help", "pending"];
  const html = renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(ApproachContext, {
        attempt: a,
        development: d,
        onFocus: () => {},
      }),
    ),
  );
  assert.match(html, /0:10/);
  assert.match(html, /0:20/);
  assert.match(html, /No answer delivered/);
  assert.match(html, /Use the record component/);
  assert.match(html, /Jump to this lookup/);
  assert.match(html, /<details/);
  assert.match(html, /2 Java questions/);
});

test("takeaways distinguish provisional intent and future practice from demonstrated deficits", () => {
  const a = reflectionFixture(),
    d = developmentFixture();
  d.approaches[0].intent = {
    status: "hypothesis",
    statement: "May be preserving input order.",
    evidence: [],
  };
  d.revisits = [
    {
      id: "later",
      approachId: "solution",
      skill: "Independent implementation",
      reason: "Try the repair independently later.",
      kind: "implementation",
      status: "open",
      evidence: [4],
      learnerEvidence: [],
    },
  ];
  const html = renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(DevelopmentSummary, {
        attempt: a,
        development: d,
        onFocus: () => {},
        onCorrect: () => {},
      }),
    ),
  );
  assert.match(html, /Possible interpretation/);
  assert.match(html, /Practice to return to/);
  assert.match(html, /Discuss or correct/);
  assert.match(html, /finish this reflection/);
  assert.doesNotMatch(html, /needs-practice/);
});
