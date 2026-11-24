import { test } from "node:test";
import assert from "node:assert/strict";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { askJavaHelp, deliverJavaHelp } from "../lib/java-help-service";
import { publicJavaHelp, referenceEvidence } from "../lib/java-help";
import { javaReferenceUrl } from "../lib/java-reference";
import { sameEvent } from "../lib/recording";
import { GET, POST } from "../app/api/java-help/route";
function fixture() {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true, Date.now() - 1000);
  const input = {
    id: crypto.randomUUID(),
    question: "What does HashSet.add return?",
    seq: 1,
  };
  db.append(a.id, [
    {
      seq: 1,
      at: a.createdAt + 1,
      type: "assistance",
      assistanceId: input.id,
      assistanceStage: "request",
      detail: input.question,
    },
  ]);
  return { db, id: a.id, input };
}
const answer = {
  answer: "Whether the set changed.",
  kind: "reference" as const,
  sources: [
    "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html",
  ],
  topics: ["Set.add"],
  model: "test",
  effort: "low",
  research: {
    sources: [],
    claims: [],
    symbols: [],
    lookups: [],
    runtime: { editorJava: 25, executionJava: null },
  },
};
test("reference requests are durable and idempotent; answers require a saved delivery marker", async () => {
  const { db, id, input } = fixture();
  let calls = 0;
  const run = async (question: string, history: unknown[]) => {
    calls++;
    assert.equal(question, input.question);
    assert.deepEqual(history, []);
    assert.equal(db.get(id).javaHelp?.[0].state, "pending");
    return answer;
  };
  const before = db.get(id);
  await askJavaHelp(db, id, input, run);
  await askJavaHelp(db, id, input, run);
  assert.equal(calls, 1);
  assert.equal(publicJavaHelp(db.get(id))[0].answer, undefined);
  assert.equal(publicJavaHelp(db.get(id))[0].research, undefined);
  assert.equal(referenceEvidence(db.get(id))[0].answer, undefined);
  assert.throws(() => deliverJavaHelp(db, id, input.id, 1), /recording event/);
  const at = Date.now() + 2;
  db.append(id, [
    {
      seq: 2,
      at,
      type: "assistance",
      assistanceId: input.id,
      assistanceStage: "response",
    },
  ]);
  deliverJavaHelp(db, id, input.id, 2, at + 1);
  deliverJavaHelp(db, id, input.id, 2, at + 1);
  assert.equal(publicJavaHelp(db.get(id))[0].answer, answer.answer);
  assert.equal(referenceEvidence(db.get(id))[0].responseSeq, 2);
  assert.equal(db.get(id).source, before.source);
  assert.equal(db.get(id).deadline, before.deadline);
  await assert.rejects(
    askJavaHelp(db, id, { ...input, question: "replace" }, run),
    /cannot be replaced/,
  );
  db.db.close();
});
test("late reference answers cannot be delivered after finish and are not counted as assistance received", async () => {
  const { db, id, input } = fixture();
  let release!: (v: typeof answer) => void;
  const pending = askJavaHelp(
    db,
    id,
    input,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  db.transition(id, "finish");
  const sealed = db.get(id);
  release(answer);
  await pending;
  assert.equal(db.get(id).javaHelp?.[0].state, "ready");
  assert.equal(db.get(id).javaHelp?.[0].deliveredAt, undefined);
  assert.equal(publicJavaHelp(db.get(id))[0].answer, undefined);
  assert.throws(() => deliverJavaHelp(db, id, input.id, 2), /timer is running/);
  assert.deepEqual(db.get(id).events, sealed.events);
  assert.equal(db.get(id).source, sealed.source);
  assert.match(
    referenceEvidence(db.get(id))[0].meaning,
    /no answer was delivered/,
  );
  db.db.close();
});
test("paused/expired assessments and invented anchors cannot request new help; failures keep the question for retry", async () => {
  const { db, id, input } = fixture();
  await assert.rejects(
    askJavaHelp(db, id, { ...input, seq: 9 }, async () => answer),
    /recording event/,
  );
  await assert.rejects(
    askJavaHelp(db, id, input, async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(db.get(id).javaHelp?.[0].state, "failed");
  db.transition(id, "pause");
  await assert.rejects(
    askJavaHelp(db, id, input, async () => answer),
    /timer is running/,
  );
  db.transition(id, "resume");
  await askJavaHelp(db, id, input, async () => answer);
  assert.equal(db.get(id).javaHelp?.length, 1);
  const a = db.get(id);
  assert.throws(
    () => deliverJavaHelp(db, id, input.id, 2, a.deadline + 1),
    /timer is running/,
  );
  db.db.close();
});
test("help identities participate in immutable recording conflict checks", () => {
  const e = {
    seq: 1,
    at: 1,
    type: "assistance" as const,
    assistanceId: crypto.randomUUID(),
    assistanceStage: "request" as const,
  };
  assert.equal(sameEvent(e, { ...e }), true);
  assert.equal(
    sameEvent(e, { ...e, assistanceId: crypto.randomUUID() }),
    false,
  );
  assert.equal(sameEvent(e, { ...e, assistanceStage: "response" }), false);
});
test("Java documentation tool accepts only official API/JLS paths", () => {
  assert.equal(
    javaReferenceUrl({
      document: "api",
      path: "java.base/java/util/HashSet.html",
      section: "add(E)",
    }).url,
    answer.sources[0],
  );
  assert.match(
    javaReferenceUrl({
      document: "language",
      path: "jls-14.html",
      section: null,
    }).url,
    /docs.oracle.com\/javase\/specs\/jls\/se25\/html\/jls-14.html$/,
  );
  for (const path of [
    "../secret.html",
    "https://evil.example/x.html",
    "//evil.example/x.html",
    "java.base/../../secret.html",
    "x.html?token=abc",
    "x%2f..%2fsecret.html",
  ])
    assert.throws(() =>
      javaReferenceUrl({ document: "api", path, section: null }),
    );
});
test("help API rejects other origins before accessing attempts", async () => {
  const headers = {
    host: "127.0.0.1:4318",
    origin: "https://elsewhere.example",
    "content-type": "application/json",
  };
  assert.equal(
    (
      await GET(
        new Request(
          "http://127.0.0.1:4318/api/java-help?id=" + crypto.randomUUID(),
          { headers },
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request("http://127.0.0.1:4318/api/java-help", {
          method: "POST",
          headers,
          body: "{}",
        }),
      )
    ).status,
    400,
  );
});
