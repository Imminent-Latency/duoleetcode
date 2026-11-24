# LeetCode browser extension spike

A local dark app plus a Manifest V3 extension. Authenticated requests run in the extension's background service worker. No LeetCode tabs, hidden tabs, offscreen documents, or content scripts are required by this design.

## Start and install

```sh
npm install
npm run leetcode:extension
npm run leetcode:serve
```

Load the unpacked extension folder `spikes/leetcode/extension` in your regular Chromium browser's extension manager with Developer mode enabled. Use the profile where you normally sign into LeetCode. No browser restart or session export is needed.

Open http://127.0.0.1:4318 in that same browser and select **Connect browser extension**. The in-app browser cannot use an extension installed in your regular browser. If LeetCode is signed out, sign in normally once, close the LeetCode tab, and reconnect.

The extension ID is stable because its manifest retains a public key. No signing private key or authentication secret is saved by the preparation command. After editing extension files, reload the extension in the browser manager; reload the app for frontend changes.

## Credentials and transport

- `BrowserSession` uses `fetch` with `credentials: 'include'` to `https://leetcode.com` only. Chromium attaches its existing login cookie automatically. The code never reads `LEETCODE_SESSION` or enumerates cookies.
- The extension reads only `csrftoken` through the browser cookies API and uses it locally as the request's CSRF header. That token is not saved in extension storage or returned in messages.
- The extension requests `cookies`, `storage`, and `declarativeNetRequestWithHostAccess` permissions and host access only to `https://leetcode.com/*`. Chrome's cookies permission applies to all cookies for that authorized host; our code narrows its use to `csrftoken`.
- Starting in v0.1.3, a temporary browser request rule sets `Origin` and the problem-specific `Referer` on judge POSTs. Its conditions require the exact endpoint, POST method, and this extension's initiator ID. It cannot match ordinary tabs or other extensions. Calls are serialized; the rule is removed afterward. Cleanup failures preserve the remote result and are reported in diagnostics. A worker termination can leave that one scoped session rule until the next judge request replaces it or the browser session ends.
- Only top-level pages at `http://127.0.0.1:4318` or `http://localhost:4318` may call the bridge. No generic URL fetch, raw GraphQL, credential export, or arbitrary header operation is exposed.
- Commands are limited to status, catalog, problem, start Run/Submit, poll owned job, verify stored source, recent job metadata, and fixed connection diagnostics. Account changes are checked before accessing saved jobs.
- The local server serves app files, the synthetic Java fixture, and public problem reads. It accepts no POST requests and has no credential import, authenticated proxy, browser profile, or login endpoint. The obsolete automated-browser profile and server-side session adapter were removed.

The extension's local journal stores job IDs, account name, source/input hashes, timestamps, verdicts and diagnostics. It does not store authentication material or source snapshots. Judge diagnostics may themselves include source excerpts and example inputs. The local page keeps the editor in memory and the last request ID in localStorage. Server-side evidence ingestion is a later task; current results return directly to the page.

## Submission behavior

The source is captured when Run or Submit is clicked. The journal is written before the remote POST. Reusing a request ID with the same source returns the saved attempt; a different payload is rejected. Interrupted or ambiguous POST outcomes are never automatically retried. A worker restart retains the remote ID; **Resume last request** polls that same attempt. Only one judging job per account is allowed at a time.

After Submit finishes, the extension reads the stored submission and compares its source hash and question ID against the submitted snapshot. The UI labels successful verification separately from the verdict. No automatic repeat occurs if readback fails.

## Validation

```sh
npm run leetcode:test
npm run leetcode:probe
```

As of November 5, 2026 (local time):

- **20 automated checks passed**: trusted callers, operation allowlist, concurrent deduplication, restart recovery, ambiguous outcomes, input/account access, wrong-answer normalization, stored-source comparison, local-only CSRF handling, response filtering, native browser fetch binding, safe rejection classification, non-executable judge diagnostics, minimal manifest capabilities, exact judge header scope, concurrent rule lifecycle, preserving results after rule-cleanup failure, fractional Run IDs through the actual client/URL allowlist, and HTTP-success error responses.
- **8 live public/server checks passed**: list pagination, filter, search, description/starter, all default examples, no backend writes/login endpoint, signed-out premium content remains locked.
- **All seven authenticated problem-access checks passed through v0.1.1** in the regular Personal browser profile with no LeetCode tabs open: account/Premium status, catalog and pagination (3,683 problems), difficulty filtering, search, free description/Java starter, all three Two Sum example inputs, and Premium Meeting Rooms description/Java starter/two example cases. Reconnecting after reloading the local app also worked. Evidence: `results/extension-live-evidence-0.1.1.json`, exported from the browser without credentials.
- **Early v0.1.1 Run and Submit requests returned HTTP 499.** They remain in the journal as unknown outcomes and were never automatically retried.
- **Version 0.1.2 confirmed CSRF validation failures** on both judge endpoints. It inspects a bounded error body inside the worker and returns only fixed classifications, never raw response bodies. **Check judge connection** sends empty payloads to the two fixed judge endpoints, with no code, language, question ID, or executable inputs. It sends no solution.
- **Version 0.1.3 resolved the submission CSRF issue.** One fixture submission passed **66/66** tests: [2190411063](https://leetcode.com/problems/two-sum/submissions/2190411063/), 2 ms, 46.6 MB. Readback confirmed the same question and exact SHA-256 of the 511-byte Java source. Refreshing the local app and selecting **Resume last request** restored this same ID and verified source, without another submission. All seven authenticated access checks passed again. Evidence: `results/extension-live-evidence-0.1.3.json` and `extension-accepted-submission.png`.
- **Version 0.1.4 passed all live Run checks.** The correct fixture returned Accepted, **3/3**; `TwoSumWrong.java` returned **Wrong Answer, 0/3**, including expected and actual outputs; `TwoSumCompileError.java` returned **Compile Error** with the missing-semicolon message and line/caret detail. Each result is linked to its fixture's source hash. No additional full submissions were made for these negative tests.
- **Run-ID validation is fixed.** LeetCode Run IDs include a decimal timestamp (confirmed by the live `runcode_1793927740.8682568_Wrg2tzCoBC` response). The former word-character/hyphen-only validator rejected periods. The shared validator now accepts bounded single-segment IDs with decimal components while rejecting traversal, slashes, query strings and fragments. Two v0.1.3 Run attempts remain unknown because the adapter did not retain their rejected IDs.
- **No LeetCode tabs were open in the extension's Personal profile** before or after the final checks. Version 0.1.4 connection diagnostics confirmed signed-in GraphQL GET/POST responses and successful temporary-header-rule cleanup. Final evidence: `results/extension-validation.json` and `extension-live-evidence-0.1.4.json`.

The requested spike is validated end to end for this account and browser: problem retrieval, subscription access, source transfer, example execution, full submission, result polling, source verification, and recovery after page refresh. Forced browser termination during an in-flight POST remains covered by local journal tests, not a deliberate live interruption.

Use **Check problem access** in the app to validate authentication, catalog pagination/filter/search, free description/starter/examples, and premium access (Meeting Rooms for a premium account). This button makes no submissions.

**Export test evidence** downloads the access checks, connection diagnostics and the account's recent request records directly from the page. The local server does not receive them. Source hashes link requests to the fixture without saving the full editor contents.

To repeat the validation, load the synthetic Two Sum fixture, Run, and Submit once. The intentionally incorrect and non-compiling fixtures are for **Run only**, avoiding extra failed submissions on the account. Verify source readback and resume after reloading the app. Keep LeetCode tabs closed throughout. If LeetCode rejects background requests, record the precise failure; do not replace the design with a hidden tab or verification bypass.

## Earlier evidence, separate from the extension

On November 5, 2026, Codex browser controls copied a 511-byte Java fixture from the local app into a signed-in LeetCode tab. Run passed 3/3 cases and [submission 2190383538](https://leetcode.com/problems/two-sum/submissions/2190383538/) passed 66/66. The user's previous editor draft was backed up privately and restored. This proved browser-assisted execution, **not** this extension's API transport.

Earlier reports remain under ignored `results/browser-checks.json`, `browser-run.txt`, `browser-submission.txt`, and screenshots. The original draft backup remains under `.local/leetcode-backups/`.

## References and remaining limits

[Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [extension cookie behavior](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [cookies permission](https://developer.chrome.com/docs/extensions/reference/api/cookies), [external messaging](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable), and [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

These are LeetCode website endpoints, not a documented stable public integration contract. Cookie settings, CSRF policy, session expiry and Cloudflare may affect background access. LeetCode's visible examples are used for Run; hidden system tests stay on LeetCode. Review [LeetCode's terms](https://leetcode.com/terms/) before shipping ongoing ingestion or redistributing problem content.

The planned product remains Next.js/Monaco with assessment recording. This directory is a standalone feasibility harness. Browser extensions are required on each device used for authenticated judging; mobile learning does not need to use this connection.
