/* Long-lived javacs worker, adapted from the verified browser-JVM spike. */
importScripts("/java/lsp-client.js", "/java/jar-transport.js");
let client,
  version = 0,
  queue = Promise.resolve(),
  diagnostics = [],
  diagnosticRevision = 0,
  currentText = "";
const uri = "file:///files/project/Solution.java";
const emit = (type, detail = {}) => postMessage({ type, ...detail });
const ready = (async () => {
  emit("status", { message: "Loading Java runtime…" });
  importScripts("https://cjrtnc.leaningtech.com/5.0/loader.js");
  const jar = createJarTransport(() => {});
  await cheerpjInit({ version: 25, status: "none", natives: jar.natives });
  cheerpjRunJar("/app/java/browser-javacs.jar")
    .then((code) => jar.exited(code))
    .catch((error) => emit("error", { message: String(error) }));
  client = new BrowserLanguageClient(jar.bridge, (type, data) => {
    if (
      type === "notification" &&
      data.method === "textDocument/publishDiagnostics"
    ) {
      if (data.params.uri === uri) {
        diagnostics = data.params.diagnostics ?? [];
        diagnosticRevision++;
      }
    }
    if (type === "transport-error") emit("error", { message: data.message });
  });
  await client.request("initialize", {
    processId: null,
    rootUri: "file:///files/project",
    workspaceFolders: [{ uri: "file:///files/project", name: "assessment" }],
    capabilities: {
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport: true,
            resolveSupport: {
              properties: ["documentation", "detail", "additionalTextEdits"],
            },
          },
        },
      },
    },
  });
  await client.notify("initialized", {});
  // Pay the initial index cost before the assessment clock starts.
  await client.notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "java",
      version: ++version,
      text: (currentText =
        "import java.util.*; class Solution { void warm(){ new ArrayList<String>().size(); } }"),
    },
  });
  await client.request("textDocument/completion", {
    textDocument: { uri },
    position: { line: 0, character: 70 },
    context: { triggerKind: 1 },
  });
  emit("ready");
})();
ready.catch((error) => emit("error", { message: String(error) }));
onmessage = ({ data }) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      await ready;
      try {
        if (data.method === "diagnostics") {
          const before = diagnosticRevision;
          await client.notify("textDocument/didChange", {
            textDocument: { uri, version: ++version },
            contentChanges: [{ text: (currentText = data.text) }],
          });
          // javacs publishes unversioned diagnostics. A synchronous save and a
          // request barrier associate them with this exact queued snapshot.
          await client.notify("textDocument/didSave", {
            textDocument: { uri },
          });
          try {
            await client.request(
              "textDocument/documentSymbol",
              { textDocument: { uri } },
              15000,
            );
          } catch (error) {
            // The outline is only a queue barrier, not the source of errors.
            // A server response error still proves the save was processed.
            // Never use stale markers after a timeout or transport failure.
            if (diagnosticRevision === before || !String(error).includes('"code":-32603')) throw error;
          }
          if (diagnosticRevision === before) throw new Error("Java did not publish diagnostics for this source");
          postMessage({ id: data.id, result: diagnostics });
        } else if (data.method === "change") {
          await client.notify("textDocument/didChange", {
            textDocument: { uri, version: ++version },
            contentChanges: [{ text: (currentText = data.text) }],
          });
          postMessage({ id: data.id, result: { version } });
        } else if (data.method === "completion") {
          await client.notify("textDocument/didChange", {
            textDocument: { uri, version: ++version },
            contentChanges: [{ text: (currentText = data.text) }],
          });
          const result = await client.request(
            "textDocument/completion",
            {
              textDocument: { uri },
              position: data.position,
              context: { triggerKind: 1 },
            },
            15000,
          );
          postMessage({ id: data.id, result });
        } else if (data.method === "codeActions") {
          await client.notify("textDocument/didChange", {
            textDocument: { uri, version: ++version },
            contentChanges: [{ text: (currentText = data.text) }],
          });
          const result = await client.request(
            "textDocument/codeAction",
            {
              textDocument: { uri },
              range: data.range,
              context: { diagnostics: data.diagnostics, only: ["quickfix"] },
            },
            15000,
          );
          postMessage({ id: data.id, result });
        } else if (data.method === "inspect") {
          const previous = currentText;
          try {
            await client.notify("textDocument/didChange", {
              textDocument: { uri, version: ++version },
              contentChanges: [{ text: data.text }],
            });
            const params = { textDocument: { uri }, position: data.position };
            const hover = await client.request(
              "textDocument/hover",
              params,
              15000,
            );
            const signatures = await client.request(
              "textDocument/signatureHelp",
              params,
              15000,
            );
            const definition = await client.request(
              "textDocument/definition",
              params,
              15000,
            );
            postMessage({
              id: data.id,
              result: {
                hover: hover ?? null,
                signatures: signatures ?? null,
                definition: definition ?? null,
              },
            });
          } finally {
            await client.notify("textDocument/didChange", {
              textDocument: { uri, version: ++version },
              contentChanges: [{ text: previous }],
            });
          }
        } else if (data.method === "resolve") {
          const result = await client.request(
            "completionItem/resolve",
            data.item,
            15000,
          );
          postMessage({ id: data.id, result });
        }
      } catch (error) {
        postMessage({ id: data.id, error: String(error) });
      }
    });
};
