# DuoLeetCode — local POC

A Java-first coding assessment app with a bounded learning loop:

**Practice → capture evidence → initial reflection form → conversational reflection → optional focused practice → choose the next activity.**

Latest work checkpoint: [November 23 — question review implementation, Stock findings, and pending improvements](docs/IMPLEMENTATION.md#status-checkpoint--november-23-2026).

## Grounded Java coaching

New AI replies include clickable citations and expandable **Sources & assumptions** with the actual retrieved excerpts, Java version, and retrieval time. The coach can inspect frozen code through the browser Java engine, read versioned Oracle documentation and pinned OpenJDK source, and search official documentation domains. Community references require an attempted primary lookup and official search first, and cannot independently justify grading. Existing saved replies retain their original evidence.

Technical claims pass receipt validation and a separate evidence audit using the selected feature model and effort. One revision is allowed before an unverifiable reply is rejected. This adds model usage and latency; it reduces unsupported feedback rather than guaranteeing correctness. The editor profile is Java 25; the judge runtime remains unknown until explicitly established.

## Getting Started

### Prerequisites

- **Node.js 26+** (uses built-in `node:sqlite`) and **npm**
- **A Chromium browser** (Chrome, Chromium, Brave, Arc, Dia, or Edge) in a normal, non-incognito profile
- **JDK 25** (needed only once on a fresh clone to compile the in-browser Java language-server assets; normal app use runs Java inside the browser via CheerpJ)
- **Codex CLI** *(optional, for AI coaching & problem selection)* signed in with ChatGPT (`codex login`)

---

### 1. Install the LeetCode Browser Extension

DuoLeetCode talks to LeetCode through an unpacked Manifest V3 browser extension (**DuoLeetCode Local Bridge** `v0.1.6`) so your LeetCode session cookies stay inside your browser and never touch the local server.

1. Open your Chromium browser and navigate to **`chrome://extensions`**.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the **`spikes/leetcode/extension`** folder inside this repository.
4. Confirm **DuoLeetCode Local Bridge** appears and is enabled.

> **Updating the extension later:** Whenever `spikes/leetcode/extension` changes, open `chrome://extensions` and click the **Reload (`↻`)** icon on **DuoLeetCode Local Bridge**.

---

### 2. Install Dependencies & Prepare Java Assets

Install Node packages:

```sh
npm install
```

On a **fresh clone**, build the in-browser Java 25 completion JARs once (downloads pinned JDT LS / `javacs` + Maven automatically; requires `JAVA_HOME` pointing to JDK 25):

```sh
JAVA_HOME=/path/to/jdk-25 npm run java:prepare
```

---

### 3. Start the Webserver

 Always keep port **`4318`** — the browser extension only accepts requests from `http://127.0.0.1:4318` and `http://localhost:4318`.

- **Development server:**
  ```sh
  npm run dev
  ```
- **Production server** (faster page loads for regular practice):
  ```sh
  npm run build
  npm start
  ```
- **Sandbox / test mode** (uses an isolated database so personal practice history is untouched; stop the regular server first since both use port `4318`):
  ```sh
  npm run dev:test
  ```

Open **[http://127.0.0.1:4318/](http://127.0.0.1:4318/)** in the **same Chromium browser** where you installed **DuoLeetCode Local Bridge** (not an Incognito window).

---

### 4. Connect Accounts in the App

- **LeetCode:** If your browser isn't signed in to LeetCode yet, click **Sign in to LeetCode** on **Today** or **Connections**. A centered sign-in popup opens, logs you in, and closes itself automatically once connected (no open LeetCode tab needs to stay open afterward). You can also try the offline local exercise anytime via **Connections → Open a demo assessment**.
- **AI Coaching (ChatGPT):** The local `codex app-server` reuses your Codex CLI ChatGPT sign-in (or you can start sign-in from **Connections**). No API key is needed; plan limits apply. `DUO_CODEX_BIN` overrides the Codex binary path and `DUO_AGENT_MODEL` overrides the baseline model (default `gpt-6.1-sol`). **Agent settings** in the sidebar configures presets and background analysis toggles locally in `.local/agent-settings.json`.
- **In-browser Java:** `javacs` runs in a Web Worker (Java 25 preview profile) for semantic completion and compiler diagnostics; **Run** and **Submit** execute on LeetCode's judge.

## What's implemented

- Dark-only Next.js App Router interface using Mantine: Today, problem library, progress, connections, assessment, review, and learning workspace. Mantine supplies navigation, dialogs, inputs, buttons, menus, test tabs, and the replay slider while Monaco retains the coding surface.
- A full-page assessment workspace with draggable/keyboard-adjustable dividers, remembered panel sizes, and hide/show controls. A compact toolbar holds the title, timer, Run and Submit. Early finish and outside-help recording are in the menu beside Submit. Problem examples are grouped into compact cards.
- A collapsible, resizable **Java help** chat in the assessment answers API/syntax questions with small examples and verified official Java documentation links. The timer continues and editing remains available. Questions and delivered replies are linked to recording events and available in the debrief. Each turn includes the cursor position and current line, plus any explicitly attached selection; solution coaching stays in the post-assessment flow. Java help uses the global agent preset and has individual Custom controls.
- Editor help is available from the **?** button beside the current line, **⌘⇧H / Ctrl+Shift+H**, or the editor context menu. Selecting code and invoking help attaches it to the composer; selections can be inspected or removed before sending. The same controls work in replay chat and the coached workspace. Context is saved per turn against the relevant recording snapshot or separately saved coached code.
- Java completion includes `sout`, `souf`, `serr`, `fori`, and `foreach` templates accepted with Tab. Debounced browser-javacs diagnostics show actual compiler errors, including missing returns; late responses are discarded when the source changes.
- Typing a standard-library class followed by `.` can offer its static members before an import exists. The adapter resolves an unambiguous `java.*`/`javax.*` type through javacs, requests real member suggestions, and adds the import only when a suggestion is accepted. Existing bindings and conflicting names are not replaced.
- Named inputs and tabs for individual test cases, add/remove/reset controls, and raw input for custom formats. Results show each run's saved inputs, actual/expected output, console output, compiler/runtime errors, result history, and original source. Unsupported custom problem formats retain raw input.
- Authenticated LeetCode search/pagination, descriptions, Java starters, example input, Run, Submit, result polling, and exact submission-source verification.
- A chosen timebox for every full problem. Preparation finishes before the problem is revealed. Explicit pause freezes timer/editing; leaving the tab records context without pausing.
- An accepted full Submit ends the assessment through the normal save-and-review flow; passing Run examples does not. Buffered edits are flushed before sealing, and the accepted submission retains its exact source even if later edits differ. Automatic finish waits for an unambiguous accepted result and does not act on known source-verification mismatches.
- Prior familiarity defaults to new without a setup question. The required post-assessment form asks New to me / Seen before / Solved before; explicit reflections are remembered for future attempts at that problem. Test sessions are excluded. Feedback receives the distinction between a default and reported familiarity, and can be refreshed after a correction.
- One canonical attempt. Each judge operation preserves the exact source and test input, a source hash, and a stable idempotency key. Unknown outcomes are never automatically submitted again.
- Every observed Monaco document change saved with its original timestamp, sequence, logical document version, UTF-16 offsets, and known origin (including undo/redo). Browser IndexedDB buffers changes until SQLite acknowledges them. Checkpoints every 50 events accelerate replay.
- Deadline/early finish freezes the assessment. Pre-deadline recovery events can be reconciled before sealing. Coaching edits are separate. Reload recovery restores the same attempt and known remote judge requests.
- A full-page reflection workspace with the recorded solution and scrubbable timeline on the left, and conversational coaching on the right. The initial familiarity, runtime complexity, and auxiliary space questions appear in the right pane with the solution visible on the left. Submitting these answers replaces the form with chat in the same workspace. Private recording analysis starts immediately while the learner answers; a follow-up generation incorporates the saved form before the first visible coach reply. Explicit uncertainty is a valid answer, and unfinished drafts survive refresh. Existing conversations resume without a retroactive questionnaire; judge results stay in the evidence rather than occupying another review panel.
- Coach-selected ranges automatically play in a loop when Follow coach is enabled. The chat’s **Pause at key moment** button stops at the coach-selected inspection snapshot; the transport pause freezes the current replay position. Point snapshots stay static. Manual range handles, 1×/2×/4×/8× playback, before/after comparison, up to five flagged moments, and a remembered Follow coach preference keep the learner in control.
- Reflection asks about approach trade-offs and time/space complexity. Missing explanations become questions, not practice deficits. Answers and corrections update takeaways with learner citations; sufficient conceptual evidence enables moving on without requiring a separate focused exercise.
- Separate reflection, evaluator, focused coach, and planner instructions on a shared local agent runtime. A portable reflection policy accepts concise explanations supported by the implementation; it asks again only for a material uncertainty or contradiction. Supported inferences require both learner quotes and recording citations. Reflection and evaluation have a narrowly scoped `read_evidence` tool. The app owns timer, persistence, transitions, replay commands, and validation.
- At most two consequential gaps, one small untimed follow-up, an immutable first response, and conversational coaching. The coach recognizes conceptual understanding rather than demanding redundant traces, cites learner evidence, and asks about unresolved gaps. Markdown questions support code, lists, and readable paragraphs.
- Sufficient evidence offers **Move on**, with optional continued conversation. **Skip coaching** and **Move on for now** are always available after the assessment, including while a coach response is pending. Skipped/manual exits do not count as demonstrated understanding. First-response results, later coached evidence, conversation history, and exit reasons are preserved separately; a completed session can be reopened.
- Attempt history, observed skill evidence, and a small provenance-labelled import of October 29 Java recall notes. Imported notes and demonstration sessions never inflate new assessment counts.

## Implementation-aware reflection

Reflection version 10 keeps an evidence-linked account of meaningful approaches in each evaluation revision: recorded implementations, learner-proposed repairs, and coach-introduced alternatives. Observations and provisional intent are separate; confirmed/corrected intent cites learner messages. Linked Java help appears in collapsible chat context with active-solving timestamps and replay controls. Takeaways expose the approach history and concrete future-practice targets, with a way to add context or correct the interpretation in chat.

The three understanding checks apply to a named baseline approach. Optional optimization discussions have a separate active approach and state, so uncertainty about a newly taught technique does not revoke a sound baseline. An optimization offer provides hint/explanation/move-on controls and saves a future target first. Moving on records deferral without rewriting the earlier evaluation. Targets feed problem prescription through a dedicated query for current, non-excluded revisit evidence; they remain eligible even after a completed reflection and are not lost behind the general recent-evidence sample. They are future practice, not mastery scores or automatically a skill deficit. Resolved/dismissed targets and earlier interpretations remain historical. Existing memory corrections/exclusions apply.

New development records travel with coaching in SQLite, backups and snapshots. They are cleared with a coaching reset; skill evidence remains a separately selectable import/export category. Existing conversations are not retroactively regraded. A new turn on a reopened conversation can build this account from its preserved evidence.

### Initial analysis pipeline

1. The assessment source and recording are sealed; pending judge jobs settle. The reflection workspace starts private preparation while the learner answers familiarity, runtime and auxiliary-space complexity beside their solution.
2. The harness supplies the problem, final code, all compact event summaries, judge snapshots/results, annotations, pauses, delivered Java reference answers, and permitted learner memory. Original timestamps stay immutable; model/replay event timing uses active solving time.
3. A deterministic retrieval index links each help request/delivery to adjacent edits and the next large deletion within five active minutes. It supplies at most six before/after checkpoints, prioritizing changes near help questions. A large deletion is currently at least 60 removed characters; this is a retrieval heuristic, not an algorithm detector. Checkpoint source is bounded at 10,000 characters with an explicit truncation flag. The complete recording remains available through `read_evidence` (32 distinct reads per model run).
4. A question generator inventories meaningful questions across correctness, approach evolution, intent, complexity, assistance, understanding, strengths and next steps. It has recording access and does not answer its questions. Separate analysts receive up to four questions each, focused starting evidence, the full event inventory and tools to retrieve any event or official Java references. At most two analyst calls run concurrently per review.
5. A fresh judge checks candidate answers against original evidence and retrieved receipts, and checks the whole question bank for missing coverage. It can request additional questions or refresh a previously reviewed finding affected by new evidence. There are at most two investigation rounds, 24 new questions per generator call, six coverage additions per judge pass and 48 retained questions overall. Remaining omissions are explicit; the system does not claim an exhaustive review. Answers distinguish observed, supported inference, plausible, unresolved and contradicted. Rejected/unverified candidate answers are excluded from the coach input.
6. A completed investigation is checkpointed privately as `reflection.questionReview`, so a failed coaching reply can reuse it. The normal reflection model then uses reviewed findings plus original evidence to produce approach stages, flags, takeaways and the conversational reply. Existing output validation and independent evidence audit remain in place. The bank is not a learner checklist and uncertainty is not a skill deficit.
7. Preparation is saved privately as `reflection.analysis`; it creates no learner-visible assessment or skill-ledger entry. Intake and later learner messages trigger targeted question updates, followed by a coverage check. Matching evidence can reuse the prior bank; recording changes, policy changes and model/effort changes invalidate reuse. The first visible reply incorporates the saved intake, then asks one consequential question or marks the baseline ready.
8. Each accepted turn appends an immutable evaluation revision with its question bank and coach message. Question entries retain the candidate, reviewed verdict, references, uncertainty, disposition, revision and links to actual questions asked in chat. Only normal audited evaluation findings enter learner memory; raw questions and rejected candidates do not. Takeaways contain a collapsed inspection view; diagnostic traces expose stage inputs, tools, research receipts and coverage verdicts. Chat activity shows which stage is working. The bank persists in SQLite/backups/snapshots even after diagnostic retention expires.

The initial retrieval shortlist remains heuristic: a strategy change spread over many small edits may not appear in the six preloaded checkpoints. The coach still sees all compact events and can inspect additional snapshots. The dedicated question stages run before the existing reflection output and use the same snapshotted Reflection model/effort setting in fresh contexts. The additional stages increase initial latency; model agreement is not proof of correctness, and the live fixtures are calibration evidence rather than a general guarantee. Completing a later assessment does not automatically resolve a target from an earlier session; that currently requires supported reflection context or a user correction/exclusion.

Run `DUO_DATABASE=:memory: DUO_TRACE_DATABASE=.local/development-eval.sqlite npx tsx tools/reflection-development-eval.ts` for six detached live cases at the configured reflection model with Low effort. The cases cover the real stock transition, sufficient concise reasoning, an ambiguous proposed approach, a complexity misconception during optional exploration, and optimization deferral. No practice attempt or agent settings are changed. `--case=<name>` selects a case; the report and isolated traces distinguish model behavior from deterministic application tests.

Run `DUO_DATABASE=:memory: DUO_TRACE_DATABASE=.local/question-review-update.sqlite npx tsx tools/question-review-eval.ts` for a live initial-review/follow-up check. It verifies that concise reasoning can finish reflection and that a later clarification updates relevant questions while preserving unrelated reviewed findings and previous evaluation revisions. These fixtures measure expected behavior, not model-to-model agreement. Question reviews retain retrieved source excerpts and links alongside their evidence references; the learner's own Java-help questions can support a literal citation, but reference answers cannot stand in for learner reasoning.

## Data and architecture

- `app/`: Next route handlers and entry points.
- `components/`: application screens and Monaco lifecycle adapter.
- `lib/store.ts`: SQLite state machine and idempotent event append.
- `lib/recording.ts`: atomic edit application, checkpoint replay, and candidate moments.
- `lib/browser.ts`: extension RPC and IndexedDB recovery buffer.
- `lib/java.ts`, `public/java/worker.js`: browser JVM/LSP adapter.
- `lib/agents.ts`: local Codex app-server protocol, scoped evidence tool, role prompts and output schemas.
- `lib/agent-settings.ts`: shared feature registry, platform presets and capability validation; `lib/agent-settings-store.ts` owns local persistence.
- `lib/java-reference.ts`, `lib/java-help-service.ts`, and `components/java-help.tsx`: scoped documentation tool, recorded reference conversation, and assessment chat.
- `lib/reflection-policy.ts`: model-independent coaching policy; `lib/reflection.ts` owns structured evidence validation.
- `lib/reflection-intake.ts` and `lib/reflection-service.ts`: required entry answers, private background preparation, and the contextualized first coach reply.
- `lib/practice-storage.mjs`: separate practice and test SQLite files, legacy migration, and verified snapshots.
- Browser database `duoleetcode-recovery`: unacknowledged changes. Keep the page open if saving fails; the recovery queue retries automatically.
- `DUO_DATA_DIR`: optional alternative data directory. `DUO_DATABASE` overrides the practice file; an overridden practice server uses a separate sibling sandbox. `DUO_BACKUP_DIR` can point to another disk.

Local API writes require the local Host and matching Origin. There is no cloud user system, sync, or authentication on this loopback-only development app. Do not expose it on a public interface. Browser-level edit ownership prevents two tabs in the same browser from editing the same attempt concurrently; conflicting events from another browser are rejected rather than merged. This is a personal practice tool, not a tamper-resistant proctoring system.

The application stores evaluation revisions and the first-response evaluation reference. Later comments do not silently rewrite earlier evidence or retarget an already answered exercise. AI evaluations are fallible: corrections and uncertainty remain part of the record.

## Practice library and recovery

Open **Your progress → Practice library**. Practice and test sessions have separate tabs. Select an ended session to browse its saved solution and event replay, exact submitted code, judge results, feedback, coaching conversation, and citations. Use **Open review workspace** to continue learning. Under **Recording → Work segments**, timer intervals are saved automatically. To record a later stretch of work on the same attempt, log its date and optionally add a note or reported minutes. Continuations do not extend the assessment or affect progress, scoring, or recommendations. **Pages import preview** is a read-only proposal; it does not insert sessions or change practice totals.

On macOS, practice lives in `~/Library/Application Support/DuoLeetCode/practice.sqlite`; tests and demonstrations go to `sandbox.sqlite`. On Linux the default is `$XDG_DATA_HOME/duoleetcode` or `~/.local/share/duoleetcode`. The first normal launch copies existing practice and test records into their respective files from a verified snapshot of the original database (including committed WAL data), and leaves the original file in place. `npm run dev:test` opens the sandbox only; stop the practice server first because both use port 4318.

**Back up now** creates a verified SQLite snapshot; **Export JSON** downloads a versioned copy of practice records and their replay data. The normal app launcher refreshes the current day's snapshot at startup and hourly while running; older daily snapshots remain in the backup directory. By default these are on the same disk, so set `DUO_BACKUP_DIR` to a separate disk if you want protection from disk loss.

```sh
npm run practice:backup
npm run practice:restore -- "/path/to/snapshot.sqlite" "/path/to/new-restored.sqlite"
```

Restore checks integrity and always writes a new file. Inspect the restored library by restarting the app with `DUO_DATABASE` pointing to that file. A JSON export is for portability; SQLite snapshots are the supported restore format.

## Agentic problem prescription

**Today** selects one timed Java problem using real practice history, imported historical sessions, corrected skill evidence, and active planning preferences. The planner searches your connected LeetCode catalog, inspects a result's statement, and verifies account access and Java support before presenting it. The browser bridge performs only catalog reads; authentication stays in your browser. The existing extension needs no update.

**Why this problem?** shows the selected evidence and its original source links. **Choose another** excludes the current suggestion without counting it as an attempt or a skill signal. **Prepare session** carries the suggested timebox into preparation; the timer starts only when you start the assessment. An unfinished assessment or learning session takes priority. Manual catalog browsing remains available.

Prescription uses **Agent settings → Next activity**, including its configured model and effort (currently Sol / Low). It offers no solution hints or editorials. Tool calls are bounded; an unavailable bridge or model produces a retryable error instead of a hidden fixed recommendation. A failed alternate search preserves the last verified suggestion.

The latest prescription is reused across refreshes for up to a day while its history, evidence, preferences, and model settings remain unchanged. Its evidence receipt, model/effort, source references, and skipped choices are stored in SQLite `memory_uses` and travel with **Memory usage receipts** in snapshots/exports. A reset or correction invalidates in-flight stale selections. This is evidence-informed selection, not a calibrated spaced-repetition or mastery model.

## Coach memory and skill evidence

Open **Coach memory** in the sidebar. **Preferences** shows what the coach may remember about how you want to learn, its original source, and revision history. Add or edit preferences, limit them to reflection/coaching/planning, or forget them. The initial three preferences come from explicit requests in the project conversation. New coach suggestions require an exact saved learner quote and stay pending until you approve them. Forgetting removes the preference and its revision text from active storage; it does not erase the original conversations or older backups.

**Skill evidence** searches dated observations from real assessments, original focused-practice responses, later coached understanding, and already-imported notes. Sources retain their attempt, quote, evaluation revision, and assistance context. Correct a coach interpretation or exclude it from future historical retrieval without rewriting the original record. Earlier assessments remain inspectable. This ledger is evidence, not a permanent mastery score. **What the coach used** records which preference revisions and historical observations were supplied to each successful agent run.

Memory is available after a real assessment ends and to the next-problem planner before an assessment. Assessment-time Java help and test sessions do not receive personal practice history. Current corrections accompany the current attempt, and historical retrieval honors exclusions. Preferences never override technical evidence or assessment boundaries. The existing role harnesses share scoped memory tools; no separate memory agent or higher reasoning setting is required. Every agent remains at Low effort with the existing Astra/Sol model choices.

Memory, evidence, corrections, and usage receipts live in the same SQLite file as their practice library and are included in snapshots and JSON exports. The schema migration indexes existing records only; the broader Pages import remains a preview. Implementations are in `lib/learner-memory.ts`, `lib/learner-context.ts`, and `components/coach-memory.tsx`.

Run `npx tsx tools/memory-eval.ts` for opt-in live Low-effort checks of preference proposals, transient remarks, sufficient concise reasoning, and genuine misconceptions. It uses synthetic in-memory records and writes a report to `.local/memory-eval.json`; it does not alter practice attempts or settings.

## Snapshots and selective fresh starts

Open **Snapshots & data** in the sidebar. **Save snapshot** keeps a named, immutable copy of both practice and test libraries, including recordings, exact judge snapshots, coaching and research citations, work segments, imported observations, coach preferences and revisions, skill evidence and corrections, memory receipts, agent settings, the staged Pages proposal, and this browser's layout preferences and reflection drafts. **Download** makes that copy portable. **Open snapshot file** validates and adds a file to the shelf without changing live practice. The older `duoleetcode-practice` JSON exports are also accepted; they contain only the data that the older export included.

Use **Review & restore** to inspect recordings, judge results, and conversations without importing them or starting an agent. Select individual sessions, include or omit their coaching, choose individual skill observations/imported notes, and choose whether to restore preferences, receipts, settings, and browser data. Existing record IDs are retained. The default is to keep current versions; replacing them is an explicit selection. Preview shows additions, replacements, removals, and preserved records before applying.

**Start fresh** offers the same selection. Remove whole sessions or clear only their post-assessment coaching while retaining solutions, recordings, judge results, assessment-time help, and work segments. A coaching reset clears familiarity answers, feedback, reflection, focused practice, and learning completion; the finished-assessment count and judge results remain. Evidence and preferences are selected separately. Evidence retained without its original session keeps its excerpts and provenance; use the saved snapshot for the full recording. Clearing imported notes and their derived evidence requires selecting both categories.

Reset and restore require finished assessments and no pending agent/judge operations. Each apply creates a recovery snapshot and rejects a stale preview. Other tabs must reload after a data change. Snapshot review never modifies live records. Cleared seeds and evidence do not reappear after restart, and new coaching after a reset has distinct evidence identities. A recovery journal rolls both databases and settings back if an apply is interrupted. The normal launcher performs pending recovery before opening the app.

Snapshots capture acknowledged state; this tab flushes its recorder before saving. Unsaved edits in another browser, recovery queues, connection handles, credentials, and LeetCode's remote submissions are not portable snapshot data. An active saved attempt restores paused; unfinished judge operations become unknown and are never automatically resent. Current browser drafts/layouts are optional and do not reset other browsers. Saved snapshots and SQLite backups remain after a live-data reset. Files are limited to 64 MB in this POC.

Snapshots normally live in `~/Library/Application Support/DuoLeetCode/snapshots`. With `DUO_DATABASE`, they live alongside that database in a `.snapshots` directory. `DUO_SETTINGS_FILE` can isolate agent settings and `DUO_PORT` can run a separate local test instance. The test server does not expose the personal-library management endpoints.

## Verification

```sh
npm run typecheck
npm test
npm run leetcode:test
npm run build
npm run agent:smoke
```

The tests cover atomic multi-cursor edits, Unicode/CRLF, undo/redo/IME outcomes, long-recording seeking, pause/deadline behavior, duplicate retries, conflicting events, source freezing, immutable first responses, origin checks, import insertion, conversation recovery, evidence validation, skip/manual exit, and the existing extension's security/judge behavior. `agent:smoke` makes a real small model request using the signed-in ChatGPT plan. `npx tsx tools/coaching-eval.ts` runs opt-in live coaching regressions against conceptual reasoning, misconceptions, bare agreement, and coached application without changing learner data.

Run `npx tsx tools/reflection-calibration-eval.ts --effort=low` for an opt-in live reflection suite. An optional `--attempt=<id>` reads only the first learner answer from a saved attempt into a detached evaluation; it never updates the attempt. Low/medium reports are kept separately in `.local`; `--model=<catalog-model>` allows isolated comparisons with other connected models without changing platform settings.

`npx tsx tools/reflection-intake-eval.ts` tests private preparation followed by the three entry answers at low effort, including sufficient answers, misconceptions, and explicit uncertainty. Synthetic fixtures only; learner attempts are not changed.

See [POC validation](docs/VALIDATION.md) for actual browser checks and remaining limits. The test session checkbox excludes an assessment from progress while still allowing real LeetCode judging. It does not change the fact that Submit creates a real LeetCode submission.

## Scope boundaries

Mobile drills, voice, approach-only assessments, HackerRank, other languages, full history migration, cloud sync, arbitrary browser-local test execution, a production login system, and advanced spaced repetition are deferred. The first recommendation system is intentionally small and evidence-driven; it does not claim a mastery score or precise retention model. LeetCode's unofficial endpoints, browser policy, and the browser JVM remain integration dependencies.

The completed feasibility spikes remain available in [Java browser research](spikes/java-browser/README.md) and [LeetCode extension research](spikes/leetcode/README.md).

`npx tsx tools/java-help-eval.ts` checks Java API/syntax help and solution-request redirects against the live connected model, using synthetic questions and the current platform settings. Reports are saved to `.local/java-help-eval.json`.

`npx tsx tools/replay-focus-eval.ts` checks a live coach selecting a range and a useful pause snapshot on synthetic evidence. The report is saved to `.local/replay-focus-eval.json`; no learner attempts or platform settings are changed.

## Agent diagnostics

Open **Agent diagnostics** in the sidebar, or **Inspect agent run** / **Inspect problem selection** beside newly generated replies and prescriptions. New model requests record their resolved instructions, input context, output schema, tool definitions, model/effort, tool arguments and results, streamed public outputs, validation/audit revisions, timing, final status, and runtime-reported token usage. Research and audit calls link to their parent. Application workflows also record validation/persistence outcomes, so model success does not hide an application failure.

Logs live in a separate local `diagnostics.sqlite`, with practice/test labels. They are **not learning evidence** and are **not included in normal practice snapshots or backups**. Use the inspector's JSON export (all logs or one complete run family) before clearing logs you want to keep. Retention defaults to 30 days and can be changed to 7/90/365 days or until manually cleared. Active families are preserved. Exports are for inspection; there is no diagnostic-log re-import or automatic model re-execution yet.

Authentication protocol traffic, stderr, and private reasoning are not captured. Recognized credential fields/patterns are redacted; prompts, code, and conversations otherwise remain in the logs. Events larger than 16 MiB are explicitly marked as truncated with a hash and preview. Diagnostic storage failures do not discard coaching results; the inspector reports a warning. A stopped process's unfinished runs are marked interrupted when the database is next opened/read. Historical activity from before tracing cannot be reconstructed.

`DUO_TRACE_DATABASE` overrides log storage. A custom `DUO_DATABASE` gets an adjacent `.diagnostics.sqlite`; test-server mode uses `sandbox-diagnostics.sqlite`; automated tests default to in-memory logs. Run `npx tsx tools/trace-smoke.ts` to exercise the signed-in runtime with synthetic input, a real tool call, and a nested model call. This uses your existing model settings and usage, creates only test-labelled diagnostic records, and leaves learner history untouched.

## Review flags and chat activity

**Flag for review** is available beside reflection/coaching replies, delivered Java-help answers, assessment feedback, recommendations, and runs in Agent diagnostics. The editor has a small flag button, a context-menu action, and **Cmd+Option+B / Ctrl+Alt+B**. The editor action captures the current code, cursor, and selection; unsaved editor text is labelled separately from the acknowledged recording. Reporting does not pause the assessment or alter its solution.

Choose a category, optionally add a note, and save. **Agent diagnostics → Review flags** lets you inspect the preserved content/solution, download a versioned review bundle, mark it reviewed, or reopen it. The bundle stores the exact saved item, attempt/conversation context, current settings, and an independent copy of the available trace family. Editor flags attach the latest attempt workflow when available, explicitly without claiming it caused the editor issue. Expired/missing traces are labelled unavailable; an in-progress copy is labelled partial. Flags survive diagnostic expiry/clear and practice resets. They are product feedback, not skill evidence or automatic coach-memory corrections. They have no automatic expiry and are exported separately from practice snapshots.

Reflection, focused coaching and Java-help chats now have a compact **Agent activity** disclosure. While a request runs it shows thinking, tool activity or audit progress. Expand it for tool inputs/results, durations, response checks/revisions, and provider-supplied thinking summaries. The harness requests `summary: auto` without changing the configured reasoning effort. Some runs/models, including the live Astra/Low validation run, provide no summary; the app says so rather than inventing one. Raw reasoning content remains excluded. Java-help progress is visible live, while details/summaries are withheld until the answer's recorded delivery. Old replies without retained traces cannot show reconstructed activity.


### Agent message formatting

All learner-facing agent prose uses the shared `CoachText` renderer with CommonMark and GitHub-flavored Markdown: headings, emphasis, lists, blockquotes, inline/fenced code, tables, strikethrough, task lists and footnotes. Tables scroll inside narrow chat panes; footnote IDs are scoped to each message. External citations still require retrieved source receipts. Raw HTML and embedded images are not rendered.

Every non-audit harness receives `agentFormattingPolicy`: procedural explanations should normally include a compact trace table, before/after state or fenced text diagram when useful. Simple acknowledgments need no visual; prediction questions should leave the predicted step unanswered. The current renderer does not execute Mermaid, render LaTeX math, or embed widgets; agents should use text diagrams and ordinary mathematical notation. This does not change independent-assessment assistance boundaries.
