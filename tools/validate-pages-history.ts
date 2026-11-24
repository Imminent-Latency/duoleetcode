import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AttemptStore } from "../lib/store";
import { captureSnapshot, parseSnapshot, projectOperation, replaceLibrary } from "../lib/snapshots";
import { lowSettings } from "../lib/agent-settings";
import { emptySelection, selectEverything } from "../lib/snapshot-types";
import { historySeed } from "../lib/history-seed";

const folder = path.resolve(process.argv[2] ?? "imports/pages-history-2026-11-10");
const snapshot = parseSnapshot(JSON.parse(readFileSync(path.join(folder,"history.snapshot.json"),"utf8")));
const normalized = JSON.parse(readFileSync(path.join(folder,"normalized-history.json"),"utf8"));
const result: Record<string, unknown> = { checkedAt: new Date().toISOString(), snapshotId:snapshot.id, snapshotSha256:snapshot.sha256, checks:[] };
const checks = result.checks as string[];
const source = (id: string) => JSON.parse(readFileSync(path.join(folder,"sources",`${id}.json`),"utf8"));
assert.equal(normalized.sessions.length,18);
assert.equal(normalized.drillItems.length,49);
assert.equal(new Set(normalized.sessions.map((s:any)=>s.key)).size,18);
for (const s of normalized.sessions) {
  const original = source(s.pageId);
  for (const b of s.sourceBlocks) assert.deepEqual(b, original.content.blocks.find((o:any)=>o.id===b.id));
  const note = snapshot.practice.importedEvidence.find(n=>n.id===`pages-session:${s.key}`)!;
  assert.deepEqual(note.historicalSession, s);
  if (s.pageId !== "page_6ad467c36e5081918bbab0d0168b2b2b") assert.deepEqual(s.sourceBlocks,original.content.blocks.filter((b:any)=>b.kind==="markdown"));
}
for (const d of normalized.drillItems) {
  const original = source(d.pageId);
  for (const b of d.sourceBlocks) assert.deepEqual(b,original.content.blocks.find((o:any)=>o.id===b.id));
  assert.match(d.originalRecord,/Prompt/);
}
checks.push("18 unique sessions and all 49 drill items retain their exact captured source blocks; full modern session pages are covered.");
assert.equal(normalized.sessions.filter((s:any)=>s.date===null).length,2);
assert(normalized.sessions.filter((s:any)=>s.date===null).every((s:any)=>s.reportedDate==="2026-10-21"));
const device=normalized.sessions.filter((s:any)=>s.key.includes("device-activity"));
assert.equal(device.length,1); assert.equal(device[0].workSegments.length,2);
assert.equal(device[0].workSegments[0].activeDurationMs,null);
assert.match(device[0].summary,/contract remains incomplete/);
assert.match(normalized.drillItems.find((d:any)=>d.pageId==="page_d501ce4431ec8191a453ae5eb3cbb4df"&&d.questionId==="Q03").originalRecord,/do not interpret.*conceptual negation gap/);
assert.match(normalized.drillItems.find((d:any)=>d.pageId==="page_2b5b9153a1a48191aab90b292e6bdfe5"&&d.questionId==="Q04").originalRecord,/request for help, not a failed code answer/);
assert.equal(snapshot.practice.attempts.length,0);assert.equal(snapshot.sandbox.attempts.length,0);
assert.equal(snapshot.settings,null);assert.deepEqual(snapshot.browser,{});assert.equal(snapshot.pagesPreview,null);
assert(snapshot.practice.memory.preferences.every(p=>p.status==="proposed"));
checks.push("Unknown dates, multi-day attempt identity, reading-slip corrections, help requests, and coached evidence preserved; no synthetic native activity or settings.");
for(const seed of historySeed) assert.equal(snapshot.practice.importedEvidence.filter(n=>n.id===seed.id).length,1);
const tmp=mkdtempSync(path.join(os.tmpdir(),"duo-pages-import-"));
const practice=new AttemptStore(path.join(tmp,"practice.sqlite")), sandbox=new AttemptStore(path.join(tmp,"sandbox.sqlite"),true);
try {
  const current=captureSnapshot(practice,sandbox,{settings:lowSettings("gpt-6-astra"),browser:{"duo-problem-width":"320"},pagesPreview:null},"Isolated fixture");
  const operation={action:"restore" as const,selection:selectEverything(snapshot),attemptMode:"whole" as const,conflicts:"keep" as const};
  const p=projectOperation(current,snapshot,operation);
  result.preview=p.preview;
  assert.equal(p.projected.practice.importedEvidence.length,29);
  assert.equal(p.projected.practice.memory.evidence.length,67);
  assert.equal(p.projected.practice.memory.preferences.length,9);
  assert.deepEqual(p.projected.settings,current.settings);
  assert.deepEqual(p.projected.browser,current.browser);
  practice.transaction(()=>replaceLibrary(practice,p.projected.practice));
  assert.equal(practice.snapshotRecords().length,0);
  assert.equal(practice.memory.search({query:"Comparator",limit:200}).some(e=>e.skill.includes("Comparator")||e.observation.includes("Comparator")),true);
  assert.equal(practice.memory.search({query:"misread",limit:200}).some(e=>e.observation.includes("misread")),true);
  assert.equal(practice.memory.search({limit:200}).length,67);
  const restored=captureSnapshot(practice,sandbox,{settings:current.settings,browser:{},pagesPreview:null},"Restored fixture");
  parseSnapshot(JSON.parse(JSON.stringify(restored)));
  assert.equal(projectOperation(restored,snapshot,operation).preview.changed,false);
  checks.push("Actual SQLite restore succeeds, historical evidence is searchable, a fresh export validates, and repeat import is idempotent.");
  const selected=emptySelection();selected.practice.imported=[`pages-session:${device[0].key}`];
  const subset=projectOperation(current,snapshot,{...operation,selection:selected});
  assert.equal(subset.projected.practice.importedEvidence.length,4);
  assert.equal(subset.projected.practice.memory.evidence.length,3);
  assert.equal(subset.projected.practice.memory.preferences.length,3);
  checks.push("Selective single-session-note restore works without adding skill evidence, activating preferences, or changing other categories.");
  const kept=restored.practice.importedEvidence.filter(n=>historySeed.some(seed=>seed.id===n.id));
  assert.deepEqual(kept,current.practice.importedEvidence);
  checks.push("The three existing warmup notes keep their current data and stable identities under Keep current; no duplicate warmup records.");
} finally {practice.db.close();sandbox.db.close();rmSync(tmp,{recursive:true,force:true});}
result.passed=true;
writeFileSync(path.join(folder,"validation.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify(result,null,2));
