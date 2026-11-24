import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("public/spell", { recursive: true });
for (const file of ["index.aff", "index.dic", "license"])
  await cp("node_modules/dictionary-en/" + file, "public/spell/" + file);
await build({
  entryPoints: ["lib/spelling-worker.ts"],
  outfile: "public/spell/worker.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  legalComments: "linked",
});
await mkdir("public/java", { recursive: true });
for (const file of [
  "browser-javacs.jar",
  "java-language-server.jar",
  "gson-2.8.9.jar",
  "protobuf-java-3.25.5.jar",
  "lsp-client.js",
  "jar-transport.js",
])
  await cp("spikes/java-browser/public/" + file, "public/java/" + file);
await cp("node_modules/monaco-editor/min/vs", "public/monaco/vs", {
  recursive: true,
});
