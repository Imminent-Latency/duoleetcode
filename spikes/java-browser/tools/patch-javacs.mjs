import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The pinned server predates records. Its null symbol kind is unboxed and
// throws after lint has already produced perfectly usable diagnostics.
export async function patchJavacs(source) {
  const file = path.join(source, 'src/main/java/org/javacs/index/FindSymbolsMatching.java');
  const text = await readFile(file, 'utf8');
  if (text.includes('case RECORD:')) return;
  const needle = 'case CLASS:\n                return SymbolKind.Class;';
  if (!text.includes(needle)) throw new Error('javacs record patch no longer matches');
  await writeFile(file, text.replace(needle, 'case CLASS:\n            case RECORD:\n                return SymbolKind.Class;'));
}
