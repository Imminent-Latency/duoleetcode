import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.JAVA_SPIKE_PORT || 4317);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jar': 'application/java-archive', '.wasm': 'application/wasm', '.css': 'text/css' };
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); return res.end(); }
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    let start = 0, end = info.size - 1;
    if (req.headers.range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!m) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end;
      if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = info.size ? end - start + 1 : 0;
    res.writeHead(req.headers.range ? 206 : 200, headers);
    if (req.method === 'HEAD' || !info.size) return res.end();
    createReadStream(file, { start, end }).pipe(res);
  } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 500); res.end(String(e)); }
}).listen(port, '127.0.0.1', () => console.log(`Java browser experiment: http://127.0.0.1:${port}`));
