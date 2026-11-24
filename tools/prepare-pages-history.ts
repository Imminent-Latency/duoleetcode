import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { historySeed } from "../lib/history-seed";
import { skillIdentity } from "../lib/learner-memory";
import { parseSnapshot, sealSnapshot } from "../lib/snapshots";
import type { LibraryImage, SnapshotData } from "../lib/snapshot-types";
import type { CoachingMemory, SkillEvidence } from "../lib/learner-memory-types";

// Offline conversion of captured Pages. Does not read or change the live library.
const folder = path.resolve(process.argv[2] ?? "imports/pages-history-2026-11-10");
const sourceFolder = path.join(folder, "sources");
type Block = { id: string; kind: string; hash: string; markdown: string };
const pages: Record<string, any> = Object.fromEntries(
  readdirSync(sourceFolder).filter(f => /^page_.*\.json$/.test(f)).map(f => {
    const p = JSON.parse(readFileSync(path.join(sourceFolder, f), "utf8"));
    assert(p.content?.blocks?.length, `Empty source: ${f}`);
    return [p.metadata.page_id, p];
  }),
);
const blocks = (id: string): Block[] => pages[id].content.blocks.filter((b: Block) => b.kind === "markdown");
const url = (id: string) => pages[id].metadata.url;
const md = (bs: Block[]) => bs.map(b => b.markdown).join("\n\n");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (value: unknown) => {
  const s = hash(value).split(""); s[12] = "5"; s[16] = "a";
  const t = s.slice(0, 32).join("");
  return `${t.slice(0,8)}-${t.slice(8,12)}-${t.slice(12,16)}-${t.slice(16,20)}-${t.slice(20)}`;
};
const sections = (bs: Block[]) => {
  const result: { heading: string; blocks: Block[] }[] = [];
  for (const b of bs) {
    if (/^#{1,6} /.test(b.markdown)) result.push({ heading: b.markdown.replace(/^#+ /, ""), blocks: [b] });
    else {
      if (!result.length) result.push({ heading: "Overview", blocks: [] });
      result.at(-1)!.blocks.push(b);
    }
  }
  return result;
};
const range = (id: string, start: string, end?: string) => {
  const bs = blocks(id), i = bs.findIndex(b => b.markdown === start);
  assert(i >= 0, `Missing heading ${start}`);
  const j = end ? bs.findIndex((b, n) => n > i && b.markdown === end) : bs.length;
  assert(j > i, `Missing end heading ${end}`);
  return bs.slice(i, j);
};
const registryId = "page_6adabe035e7c819194fd158b0c48f9cd";
const legacyId = "page_6ad467c36e5081918bbab0d0168b2b2b";
const fluencyId = "page_0e3e3035678081919fe4447a8be445e0";
const guideId = "page_f41348a4966481919bd43db8d044e798";
const splitRow = (line: string) => line.slice(1, -1).split(/(?<!\\)\|/).map(x => x.trim());
const registryTable = blocks(registryId).find(b => b.markdown.startsWith("| Attempt key"))!;
const rows = registryTable.markdown.split("\n").slice(2).map(splitRow);
assert.equal(rows.length, 12);
const skills = ["Algorithm pacing", "Repository request and persistence flow", "Running aggregates and numeric range", "Hash-map lookup and contract reasoning", "First-occurrence search", "Stack invariants and boundary cases", "Linked-list initialization", "Interval merge state", "Binary-search membership and progress", "Sliding-window state and aggregate complexity", "Grid traversal and complexity", "Repository contract coverage and tie-breaking"];
const supports = [
  "Self-reported incomplete attempt; algorithm, code, tests, and assistance were not assessed. Actual attempt date unknown.",
  "Self-reported passing repair; exact passing changes, test count, assistance, and actual attempt date are unknown. Inspected original code is separate.",
  "Running-average approach preceded help; final completion used an exact overflow diagnosis and int-to-long correction. Submissions 2–9 source unavailable.",
  "Revisit; no assistant algorithm help before acceptance. The design revision and API exploration were learner-reported; elapsed components are not all typing time.",
  "Platform supplied binary-search guidance. No assistant hints before acceptance; accepted historical source was unavailable, so code-level review remains pending.",
  "Revisit; no assistant algorithm hints or fixes before acceptance. Four submissions belong to one attempt; stale notes do not establish a current misconception.",
  "Platform walkthrough plus conceptual trace and exact lastNode = head guidance. Assisted correction untimed; total solve time unknown.",
  "Java API lookups during implementation and guided merge-state/final-append repair. Guided duration unknown; final editor is not substituted for unavailable submission source.",
  "Exact algorithm/pseudocode guidance and later condition coaching. Correct post-coaching explanations do not establish independent reconstruction or delayed recall.",
  "Learner independently changed representation; final duplicate-index/boundary repair and complexity reasoning were coached. Full guided duration unknown.",
  "No assistant algorithm help before acceptance; external assistance unconfirmed. Learner supplied complexity bounds; worst-case/amortized terminology clarified afterward.",
  "One attempt across October 26 and 28. Prior review and permitted API help retained. Supplied suite passed 20/20, but opposite-arrival sequence tie-break failed. Reported elapsed readings are not verified active totals.",
];
const sessions: any[] = rows.map((row, i) => {
  const [key, title, summary, ref] = row;
  const pageId = ref.match(/page_[a-f0-9]{32}/)![0];
  let bs = blocks(pageId);
  if (i === 0) bs = range(pageId, "# Minimum adjacent swaps coding exercise", "# Post creation repository exercise");
  if (i === 1) bs = range(pageId, "# Post creation repository exercise", "# Count Elements Greater Than Previous Average");
  if (i === 2) bs = range(pageId, "# Count Elements Greater Than Previous Average", "# Future practice and progress");
  return { key, title: title.split(" · ")[0], kind: [1,11].includes(i) ? "repository" : "coding", date: key.match(/2026-10-\d\d/)?.[0] ?? null, reportedDate: i < 2 ? "2026-10-21" : null, track: "Amazon Leo", summary: i < 3 ? summary : bs[0].markdown, skill: skills[i], support: supports[i], pageId, source: url(pageId), sourceBlocks: bs, registry: { pageId: registryId, blockId: registryTable.id, row: row.join(" | ") } };
});
const systemBlocks = [...range(legacyId, "# Satellite network agent platform", "# Minimum adjacent swaps coding exercise"), ...range(legacyId, "## Feedback corrections from October 17 2026")];
sessions.push({ key: "legacy-satellite-network-system-design-1", title: "Satellite network agent platform", kind: "system-design", date: "2026-10-17", reportedDate: null, track: "Amazon Leo", summary: "Completed system-design mock. Durable workflow, safety, load-management and AI-risk reasoning were recorded. Client-generated idempotency and uncertain submissions were coached. Later feedback corrected persistence and recovery-window criticisms; numerical sizing and detailed storage were insufficiently assessed.", skill: "System design: agent safety, durability and idempotency", support: "A single mock with interviewer/timing limitations. Broad prompts are distinct from answer-supplying hints. Preserve the October 17 feedback corrections; no employer pass/fail or mastery result is inferred.", pageId: legacyId, source: url(legacyId), sourceBlocks: systemBlocks });
const recallIds = ["page_d501ce4431ec8191a453ae5eb3cbb4df", "page_56d02273d2248191af7252afbc6b6f9b", "page_2b5b9153a1a48191aab90b292e6bdfe5", "page_2b55cebde5f8819180b36c10867ec162", "page_75d0c8a4479081919bda4380e0335909"];
const recallDates = ["2026-10-24", "2026-10-25", "2026-10-27", "2026-10-28", "2026-10-29"];
const drillItems: any[] = [];
for (const [i, pageId] of recallIds.entries()) {
  const bs = blocks(pageId), ss = sections(bs);
  const items = ss.filter(s => /^Q\d{2} /.test(s.heading)).map(s => ({ key: `pages:${pageId}:${s.heading.slice(0,3)}`, questionId: s.heading.slice(0,3), title: s.heading.slice(4), sessionKey: `pocket-${pageId}`, date: recallDates[i], source: url(pageId), pageId, sourceBlocks: s.blocks, originalRecord: md(s.blocks) }));
  drillItems.push(...items);
  sessions.push({ key: `pocket-${pageId}`, title: `Pocket Coding Practice · Session ${i + 1}`, kind: "recall", date: recallDates[i], reportedDate: null, track: null, summary: bs[0].markdown, skill: `Java recall · Session ${i + 1}`, support: "Untimed conversation; preserve first response, assistance, corrections and later transfer separately. Planned allocations are not measured durations. This is not a whole-problem attempt or applied-use count.", pageId, source: url(pageId), sourceBlocks: bs, items });
}
assert.equal(sessions.length, 18);
assert.equal(drillItems.length, 49);
for (const s of sessions) {
  s.datePrecision = s.date ? "day" : "unknown";
  s.startedAt = null; s.endedAt = null; s.activeDurationMs = null; s.recording = null;
  s.sections = sections(s.sourceBlocks).map(x => ({ title: x.heading, blockIds: x.blocks.map(b => b.id), markdown: md(x.blocks) }));
  s.codeExcerpts = s.sourceBlocks.filter((b: Block) => /```/.test(b.markdown)).map((b: Block) => ({ blockId: b.id, markdown: b.markdown, provenance: "Verbatim Page excerpt; consult its section for submission-versus-editor attribution." }));
  s.timingRecords = s.sections.filter((x: any) => /timing|checkpoint|submission|result and timing/i.test(x.title));
  s.workSegments = s.key.includes("device-activity") ? [
    { date: "2026-10-26", reportedElapsed: "38:34.64", activeDurationMs: null, kind: "original-attempt", source: s.source },
    { date: "2026-10-28", reportedElapsed: "58:38.18", activeDurationMs: null, kind: "continuation", source: s.source },
  ] : [];
}

const notes: any[] = sessions.map(s => ({
  id: `pages-session:${s.key}`, skill: s.title, date: s.date, profile: s.kind === "system-design" ? "System design" : s.kind === "recall" ? "Java 8" : "Java · profile in source",
  observation: s.summary, support: s.support, source: s.source, blocks: s.sourceBlocks.map((b: Block) => b.id), provenance: "Imported Pages session record", durationMs: null,
  historicalSession: s, sourceRevision: { updatedAt: pages[s.pageId].metadata.updated_at, blockHashes: s.sourceBlocks.map((b: Block) => ({ id: b.id, hash: b.hash })) },
}));
const evidence: SkillEvidence[] = [];
function addEvidence(noteId: string, skill: string, observation: string, support: string, date: string | null, pageId: string, bs: Block[], sessionKey?: string, kind = "historical-note") {
  evidence.push({ id: `imported:${noteId}`, skillId: skillIdentity(skill), skill, kind: "imported-note", observation, support, outcome: kind,
    // Noon UTC is a date-sort surrogate, never an observed session timestamp.
    at: date ? Date.parse(`${date}T12:00:00Z`) : 0, current: true,
    source: { label: `${pages[pageId].content.title}${date ? ` · recorded ${date}` : " · date unknown"}`, url: url(pageId), ...({ pageId, blocks: bs.map(b => b.id), datePrecision: "day", timestampMeaning: "date-only sorting surrogate; not measured time", historicalSessionKey: sessionKey, excerpts: bs.map(b => ({ blockId: b.id, markdown: b.markdown })) } as any) },
  });
}
for (const s of sessions.filter(s => s.kind !== "recall")) addEvidence(`pages-session:${s.key}`, s.skill, s.summary, s.support, s.date ?? s.reportedDate, s.pageId, s.sourceBlocks, s.key);
// Each drill is a historical evidence item. Keep its complete saved wording rather
// than regrading it during migration. Three existing paired warmup notes retain IDs.
for (const d of drillItems.filter(d => d.pageId !== recallIds[4])) {
  addEvidence(d.key, d.title, d.originalRecord, "Imported dated recall evidence. Read the original first response, assistance, self-correction, and transfer labels below; no new assessment or mastery score was generated.", d.date, d.pageId, d.sourceBlocks, d.sessionKey);
}
for (const [i, seed] of historySeed.entries()) {
  const items = drillItems.filter(d => d.pageId === recallIds[4]).slice(i * 2, i * 2 + 2);
  const bs = items.flatMap(d => d.sourceBlocks);
  notes.push({ ...seed, originalItems: items, sourceRevision: { updatedAt: pages[recallIds[4]].metadata.updated_at, blockHashes: bs.map(b => ({ id: b.id, hash: b.hash })) } });
  addEvidence(seed.id, seed.skill, seed.observation, seed.support, seed.date, recallIds[4], bs, `pocket-${recallIds[4]}`);
}
const fluencyTable = blocks(fluencyId).find(b => b.markdown.startsWith("| Pattern | Attempt |"))!;
const fluency = fluencyTable.markdown.split("\n").slice(2).map(splitRow).map((r, i) => {
  const [skill, attempt, supportCode, observation] = r;
  const pageId = attempt.match(/page_[a-f0-9]{32}/)![0];
  const support = ({ I: "Independent pattern use documented", L: "Correct pattern use after lookup", P: "Correct pattern use after targeted help", U: "Correct use demonstrated; retrieval support unknown" } as Record<string,string>)[supportCode];
  const date = observation.includes("Oct 28") || attempt.includes("Oct 28") ? "2026-10-28" : sessions.find(s => s.pageId === pageId && s.kind !== "system-design")?.date ?? "2026-10-22";
  const rowBlock = { ...fluencyTable, markdown: `| Pattern | Attempt | Support | Evidence and friction |\n| --- | --- | --- | --- |\n| ${r.join(" | ")} |` };
  const row = { id: `pages-fluency:${pageId}:${skillIdentity(skill)}`, skill, date, profile: "Java 8 / repository profile in source", observation, support: `${support}. Pattern-specific evidence, not whole-solution independence; one use for the canonical attempt.`, supportCode, source: url(fluencyId), attemptSource: url(pageId), blocks: [fluencyTable.id], provenance: "Imported applied Java evidence", durationMs: null, sourceRow: r };
  notes.push(row);
  addEvidence(row.id, skill, observation, row.support, date, fluencyId, [rowBlock]);
  return row;
});
assert.equal(fluency.length, 8);
assert.equal(notes.length, 29);
assert.equal(evidence.length, 67);
assert.equal(new Set(evidence.map(e => e.id)).size, evidence.length);

const prefSpecs = [
  ["one-topic", "Use one immediate sticking point and reuse the available context instead of repeating intake.", "7ed81774-d161-4c16-8ec8-3a5317d4bff2"],
  ["visual-traces", "Use one compact example or visual trace. Label positions separately from stored values and explain what remains possible and why.", "f4df8087-380f-46d0-ad4f-e833edb1ce24"],
  ["complete-explanation", "Explain the prerequisite clearly, then ask one complete transfer question. Avoid long chains of tiny questions when the underlying idea is missing.", "2af438b0-2a7b-4c12-bb7e-17ce4d74d534"],
  ["change-representation", "When I say I am looping or keep applying the same incorrect rule, switch to a concrete trace or worked example and reduce the task to one decision.", "88f74889-3b54-4693-af3e-cc348f0ba34b"],
  ["preserve-credit", "Credit a correct choice separately from an incorrect justification or notation. Preserve the first response and assistance, and stop the specific repair once its goal is demonstrated.", "6bb0d9ad-f290-4019-9d52-6d865bf14ed6"],
  ["lightweight-reasoning", "Keep pre-coding reasoning lightweight: identify the invariant, challenge it with a small valid input, then trace one state change. Accept spoken reasoning in short drills.", "36c3111c-eba2-4a00-afa2-8a6ef9df1fef"],
];
const oldManifest = path.join(folder, "manifest.json");
const preparedAt = existsSync(oldManifest) ? JSON.parse(readFileSync(oldManifest, "utf8")).preparedAt : new Date().toISOString();
const preferences: CoachingMemory[] = prefSpecs.map(([key,text,blockId]) => {
  const b = blocks(guideId).find(b => b.id === blockId); assert(b);
  return { id: `pages-guide:${key}`, revision: 1, text, scope: "coaching", status: "proposed", origin: "coach-suggestion", source: { label: "Saved Coding Coaching Guide · import proposal", quote: b.markdown, url: url(guideId) }, createdAt: Date.parse(preparedAt), updatedAt: Date.parse(preparedAt) };
});
const sourceInventory = Object.entries(pages).map(([id,p]) => ({ pageId:id, title:p.content.title, url:p.metadata.url, updatedAt:p.metadata.updated_at, blocks:p.content.blocks.length, file:`sources/${id}.json`, sha256:hash(p) }));
const manifest = {
  format: "duoleetcode-pages-conversion", version: 1, preparedAt,
  coverage: { historicalSessions:18, coding:10, repository:2, systemDesign:1, recallSessions:5, drillItems:49, scoredCodeAnswerUnavailableItems: ["Session 3 Q04: help request before an answer"], appliedPatternObservations:8, importedNotes:29, skillEvidence:67, proposedPreferences:6, reusedWarmupIds:historySeed.map(x=>x.id), sourcePages:sourceInventory.length },
  mappings: { nativeAttempts:0, historicalNotes:"18 session records + 8 applied-pattern records + 3 existing paired warmup notes", skillEvidence:"13 whole-session summaries + 43 individual drill records + 3 paired warmup observations + 8 applied-pattern observations", coachingPreferences:"Six proposals; importing does not activate them until approved in Coach memory." },
  limitations: [
    "No live library import has been applied. Original Spaces are unchanged.",
    "Historical notes and skill evidence are supported now. Native historical session playback/counts are not; no synthetic events, timestamps, LeetCode jobs, or chat turns were invented.",
    "The normalized session records retain source sections, timing/submission tables, code excerpts, work segments, and exact saved drill wording. These remain attached data until the app supports a native historical-session view.",
    "Two sample-assessment attempts have unknown actual dates. October 21 is their report date only. Date-only evidence uses a sorting surrogate, not a measured timestamp.",
    "Device Activity is one attempt across two dates. Supplied tests passing does not mean its contract was complete. Reported elapsed readings are not summed into active time.",
    "Pages contain saved records, not necessarily full chat transcripts or every historical revision. Current text and embedded corrections are preserved; absent source is not reconstructed.",
    "The five short-drill sessions contain 49 items, including a help request before an answer. Immediate coached transfer is not relabeled delayed independent recall.",
    "Pocket AI has zero recorded sessions. Future exercises, untested skills, study-plan allocations, reference examples, setup probes, and duplicated hub summaries do not become attempts or skill-use observations.",
    "The snapshot does not change model settings, browser layouts, sign-ins, or the staged Pages proposal. Keep-current is the recommended conflict policy; three existing warmup records reuse their IDs.",
    "Saved source links and claims are migration provenance. This task did not re-run old submissions or revalidate every historical technical claim.",
  ], sourceInventory,
};
const memory: LibraryImage["memory"] = { version:1, preferences, preferenceRevisions:preferences.map(p=>({id:p.id, revision:p.revision, data:JSON.stringify(p)})), forgotten:[], evidence:evidence.map(e=>({id:e.id,attempt_id:null,skill_id:e.skillId,current:1,at:e.at,data:JSON.stringify(e)})), corrections:[], uses:[], suppressed:[] };
const blank: LibraryImage = {attempts:[],importedEvidence:[],memory:{version:1,preferences:[],preferenceRevisions:[],forgotten:[],evidence:[],corrections:[],uses:[],suppressed:[]}};
const snapshot: SnapshotData = { format:"duoleetcode-snapshot", version:1, id:uuid({notes,memory}), name:"Pages history · October 17–29, 2026", createdAt:preparedAt, practice:{attempts:[],importedEvidence:notes,memory}, sandbox:blank, settings:null,browser:{},pagesPreview:null };
const archive = parseSnapshot(sealSnapshot(snapshot));
function write(name: string, value: unknown) { writeFileSync(path.join(folder,name), JSON.stringify(value,null,2)+"\n", {mode:0o600}); }
write("history.snapshot.json",archive);
write("normalized-history.json",{format:"duoleetcode-historical-source-records",version:1,preparedAt,sessions,drillItems,fluency,coachingPreferenceProposals:preferences,sourceInventory});
write("manifest.json",manifest);

const esc = (s: string) => s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
marked.use({renderer:{html:({text})=>esc(text),link:({href,text})=>/^https?:\/\//.test(href)?`<a href="${esc(href)}" target="_blank" rel="noreferrer">${text}</a>`:esc(text)}});
const render = (text: string) => marked.parse(text) as string;
const sessionHtml = sessions.map((s,i)=>`<article id="session-${i}" data-search="${esc((s.title+" "+s.kind+" "+s.date).toLowerCase())}"><div class="eyebrow">${esc(s.kind)} · ${esc(s.date??"Attempt date unknown")}${s.reportedDate?` · reported ${esc(s.reportedDate)}`:""}</div><h2>${esc(s.title)}</h2>${render(s.summary)}<p class="support">${esc(s.support)}</p><a href="${esc(s.source)}" target="_blank" rel="noreferrer">Open original Page ↗</a><details><summary>Read preserved record${s.items?` · ${s.items.length} drill items`:""}</summary><div class="original">${render(md(s.sourceBlocks))}</div></details></article>`).join("\n");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your practice history · Import review</title><style>
:root{color-scheme:dark;--bg:#0d1418;--panel:#172229;--ink:#e3ecec;--muted:#a2b7bc;--mint:#a7dec6}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:58px 28px}h1{font-size:clamp(32px,5vw,55px);line-height:1.12;letter-spacing:-.04em;max-width:750px}h2{font-size:25px;line-height:1.3}h3{font-size:20px}a{color:var(--mint)}.eyebrow{color:var(--mint);font-size:12px;letter-spacing:.13em;text-transform:uppercase}.lede{max-width:830px;color:var(--muted);font-size:19px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:32px 0}.stat,article,.box{background:var(--panel);border:1px solid #30424b;border-radius:14px;padding:24px;margin:18px 0}.stat{margin:0}.stat b{font-size:35px;display:block;color:var(--mint)}.stat span{font-size:13px;color:var(--muted)}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:25px 0}.button{display:inline-block;background:var(--mint);color:#0b271f;padding:10px 17px;border-radius:9px;font-weight:650;text-decoration:none}.secondary{background:var(--panel);border:1px solid #38545c;color:var(--ink)}.support{border-left:3px solid #76aa98;padding-left:16px;color:var(--muted)}details{margin-top:20px;border-top:1px solid #344850;padding-top:14px}summary{cursor:pointer;color:var(--mint);font-weight:600}.original{padding-top:18px;overflow-wrap:anywhere}.original h1{font-size:28px}.original h2{font-size:23px}.original h3{font-size:19px}.original pre{overflow:auto;max-height:500px}pre,code{font-family:ui-monospace,monospace}code{background:#101a20;padding:.1em .25em;border-radius:4px}pre{background:#0c161d;padding:20px;border-radius:10px;white-space:pre-wrap}table{border-collapse:collapse;display:block;overflow-x:auto;font-size:14px}td,th{padding:10px;border:1px solid #38505a;min-width:120px;text-align:left}input{width:100%;font:inherit;padding:12px 16px;border:1px solid #3c535e;border-radius:9px;background:#0b171f;color:var(--ink)}.small{font-size:13px;color:var(--muted)}[hidden]{display:none}@media(max-width:650px){main{padding:30px 18px}.stats{grid-template-columns:repeat(2,1fr)}article,.box{padding:18px}}@media print{details>.original{display:block}.actions,input{display:none}body{background:white;color:black}article,.box{break-inside:avoid}}
</style></head><body><main><div class="eyebrow">DuoLeetCode · Pages history · Ready for review</div><h1>Your practice, preserved with its context.</h1><p class="lede">A source-linked import of the history recorded in Spaces. Original responses, help, corrections, code excerpts, and timing qualifications travel together. Nothing has been applied to your live library.</p><div class="stats"><div class="stat"><b>18</b><span>historical sessions</span></div><div class="stat"><b>49</b><span>short-drill items</span></div><div class="stat"><b>8</b><span>applied Java observations</span></div><div class="stat"><b>67</b><span>searchable evidence records</span></div></div><div class="actions"><a class="button" href="history.snapshot.json" download>Download import file</a><a class="button secondary" href="normalized-history.json" download>Detailed source records</a><a class="button secondary" href="manifest.json" download>Coverage and limitations</a></div><div class="box"><h2>What the app can use now</h2><p>Restore <strong>Imported historical notes</strong> and <strong>Skill evidence and corrections</strong> from this file in <strong>Snapshots &amp; data → Open snapshot file</strong>. Use <strong>Keep my current version</strong> to preserve existing records. The six coaching preferences are optional proposals; they remain pending until you approve them in Coach memory.</p><p>These are imported records, so native assessment totals, streaks, timers and replay are unchanged. The full historical sections are preserved for inspection here and for a later native history view. Model settings and sign-ins are not part of this import.</p><p class="small">Composition: 10 coding exercises, 2 repository exercises, 1 system-design mock, and 5 recall sessions. Device Activity remains one attempt across October 26 and 28. Pocket AI has no completed sessions. Three existing warmup observations retain their IDs.</p></div><h2>Review the history</h2><input id="search" aria-label="Filter historical sessions" placeholder="Filter by problem, date, or session type"><p class="small">Expand a record to read the preserved source. Reported, observed, assisted, and unmeasured evidence retain their original distinctions.</p>${sessionHtml}<section class="box"><h2>Applied Java evidence</h2>${fluency.map(f=>`<details><summary>${esc(f.skill)} · ${esc(f.date)}</summary><p>${esc(f.observation)}</p><p class="support">${esc(f.support)}</p><a href="${esc(f.attemptSource)}" target="_blank" rel="noreferrer">Canonical attempt ↗</a></details>`).join("")}</section><section class="box"><h2>Coaching preferences · proposals only</h2>${preferences.map(p=>`<details><summary>${esc(p.text)}</summary><p>Source wording:</p>${render(p.source.quote)}<a href="${esc(p.source.url!)}" target="_blank" rel="noreferrer">Original guide ↗</a></details>`).join("")}</section><section class="box"><h2>Coverage and limits</h2><ul>${manifest.limitations.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></section></main><script>document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('article[data-search]').forEach(a=>a.hidden=!a.dataset.search.includes(q));});</script></body></html>`;
writeFileSync(path.join(folder,"history-review.html"),html,{mode:0o600});
console.log(JSON.stringify({snapshotId:archive.id,bytes:Buffer.byteLength(JSON.stringify(archive)),...manifest.coverage},null,2));
