# Browser JVM / Java completion experiment

## Result

**Feasible for continued POC work: unmodified javacs runs inside CheerpJ and returns semantic Java completions across successive document edits.** Keep local JDT LS as the fallback. This experiment does not establish production readiness or measure Monaco integration.

On November 3, 2026 (America/Los_Angeles), the final validation run passed five initial scenarios and twenty additional requests against the same running engine. The engine received full document changes between requests; this was not repeated retrieval of a static suggestion list.

| Measurement | Observed result |
| --- | --- |
| Runtime and engine initialization, through successful LSP initialize response | 4,622 ms |
| First completion request, including compiler configuration and JDK indexing | 2,272 ms |
| Warm requests | 20 / 20 passed |
| Warm median / p95 / maximum | 50 / 56 / 60 ms |
| Main-page 100 ms heartbeat | 82 samples, maximum scheduling delay 3 ms, no delays over 50 ms |
| Browser | Headless Chromium 156.0.8078.4 |

Raw evidence: [final validation](results/javacs-jar-validation.json), [first successful full run](results/javacs-jar-java25.json), and [JDT browser failure](results/jdt-java25.json). The final report includes source hashes. A screenshot is generated beside each report.

These are measurements from one local machine and one short validation session, not a cross-device benchmark. The heartbeat measures the harness page's event loop, not actual Monaco typing latency. Startup is a fresh browser context but is not a controlled cold-cache network benchmark. Total browser memory, CPU consumption, runtime download bytes, and offline startup have not been measured.

## What passed

- `Map<String, Integer>` member suggestions, including `get` and `put`.
- `Map<String, List<Integer>>.get(...)` resolves to list methods, including `add` and `get`.
- `PriorityQueue<Integer>` suggests `peek` and `poll`.
- A user-defined `TreeNode` suggests its `left` and `val` fields.
- `String` suggests `substring` and `charAt`.
- Subsequent edits and repeated compilation work within the same JVM/engine session.

Each fixture is intentionally incomplete at the cursor, as real code is while typing. Suggestions come from the upstream Java compiler-backed engine. No Java parsing, type inference, or API suggestion catalogue was implemented in JavaScript.

## Architecture that worked

```text
Browser harness
    ↕ worker messages
Web Worker
    ├─ byte-framed LSP client and synthetic fixtures
    └─ CheerpJ 5.0 / Java 25 preview
         └─ executable JAR with standard manifest launch settings
              └─ unmodified javacs language server
```

`BrowserJarLauncher.java` supplies in-memory standard input/output and native JavaScript callbacks. These callbacks only transport messages. The JAR manifest supplies the engine's required `Add-Opens` and `Add-Exports` settings. Launching the engine in that same executable-JAR context is necessary: launching a separate configuration JAR and then switching to library mode did not preserve the required access for the engine.

The local Node server serves static files with HTTP Range support. It has no compile, completion, or Java-execution endpoint. A native JDK is used only during artifact preparation. CheerpJ's runtime assets currently come from its public CDN; this is local application execution, not a fully offline distribution.

The assessment should start its timer **after the runtime and an initial compiler request are ready**. The observed first-use work totals approximately seven seconds, while subsequent small-file requests are much faster.

## Alternatives tested

1. **JDT LS 1.64.0 through CheerpJ:** reached Equinox startup, but JNA's native-platform capability could not resolve for architecture `cheerpj`. Dependent Eclipse bundles also failed. No initialize response arrived before the four-minute harness cutoff. This proves a compatibility obstacle for this distribution/configuration, not that every possible JDT browser port is impossible. No local JDT LS fallback was started.
2. **javacs through CheerpJ library mode:** initialized and produced a correct first Map completion. A subsequent edit failed when `JavacTaskImpl.cleanup()` required a module opening normally provided by the desktop launcher. Supplying `jdk.module.addopens.0` as a system property did not fix it. Serializing JavaScript-to-Java calls was also necessary in library mode.
3. **javacs as an executable JAR:** standard manifest launch settings applied in the engine's own context. All final completion checks passed. This is the selected browser candidate; no upstream engine source changes were needed.

Early adapter and configuration failures are retained in `results/` for diagnosis. They are not performance measurements of working engines.

## Reproduce

Prerequisites: Node.js with npm, JDK 25 for building artifacts, Git, and tar. Set `JAVA_HOME` to a JDK 25 installation if it is not found at the tested SDKMAN location. This does not change the user's default JDK. The Java bridge and launcher are built with Java 8 and 17 bytecode targets respectively; javacs itself is built for Java 25.

From the project root:

```sh
npm install
npm run java:prepare
npm run java:serve
```

In another terminal, if Playwright's browser is not installed:

```sh
npx playwright install chromium
```

Then:

```sh
JAVA_PROBE_REPORT=javacs-jar-validation npm run java:probe -- javacs-jar 25 warm=20
```

The report filename can be changed to preserve earlier runs. A nonzero exit code indicates a timeout, transport/runtime error, or failed completion assertion. The harness uses a disposable worker and terminates it at the end of the check, on cancellation, or at the four-minute cutoff.

Other useful probes:

```sh
npm run java:probe -- smoke 25
npm run java:probe -- manifest 25
npm run java:probe -- javacs 25
npm run java:probe -- jdt 25
```

The last two commands deliberately exercise the earlier incompatible launch configurations. The UI defaults to the working executable-JAR candidate. All modes use the same local file server.

## Pinned dependencies

- CheerpJ loader: `https://cjrtnc.leaningtech.com/5.0/loader.js`, default execution engine, Java 25 preview. Experimental WasmGC is not enabled.
- javacs: `georgewfraser/java-language-server` commit `58daaa29a0e2fe22764283607da6801cf8b493b9`.
- JDT LS archive: `jdt-language-server-1.64.0-202610301801.tar.gz`, SHA-256 `3bff77299e7449ddec5466e1c600a5f221312b057240b06162b7d9326bb9ca5e`.
- Maven 3.9.11 for artifact preparation.
- Playwright 1.64.1, with npm lockfile.

The preparation script verifies the JDT archive checksum and builds javacs with its existing Maven project. It skips upstream tests because the immediate purpose is artifact preparation, then validates the resulting engine through the actual browser LSP interface. The upstream repository was not modified. Downloaded dependencies and built binaries are ignored by Git.

## Still to validate before choosing the production integration

- Monaco completion rendering, Tab acceptance, indentation, cancellation, and stale-result rejection.
- Import insertion, overload/signature help, diagnostics, and documentation quality. The current runtime does not include a discoverable JDK `src.zip` for javacs's documentation lookup.
- A Java 8 language/API profile. **The current trial exposes Java 25 APIs**, including methods unavailable in Java 8; do not use it to grade Java 8 API recall yet.
- Longer sessions, larger files, memory growth, cold/warm downloads, Safari/Firefox, and slower devices.
- CheerpJ deployment/license fit if this moves beyond the current local evaluation.

The main application remains Next.js, Monaco, and dark-only styling. Keep language support behind a replaceable adapter so a later local JDT LS transport does not require changing assessment recording.

## Primary references

- [CheerpJ Java library integration](https://cheerpj.com/docs/getting-started/Java-library)
- [CheerpJ executable JAR API](https://cheerpj.com/docs/reference/cheerpjRunJar)
- [CheerpJ native-method callbacks](https://cheerpj.com/docs/guides/implementing-native-methods)
- [CheerpJ compatibility and Java 25 preview status](https://cheerpj.com/compatibility/)
- [javacs source](https://github.com/georgewfraser/java-language-server)
- [JDT LS source and launch requirements](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
