import { chromium } from 'playwright';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] || 'javacs-jar';
const version = process.argv[3] || '25';
const options=process.argv[4]||'';
const timeout = Number(process.env.JAVA_PROBE_TIMEOUT || 240000);
const results = fileURLToPath(new URL('../results/', import.meta.url));
const reportName=process.env.JAVA_PROBE_REPORT||`${mode}-java${version}`;
await mkdir(results, {recursive:true});
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
const page = await context.newPage();
const record = {started:new Date().toISOString(), browser:browser.version(), mode, version, options, events:[], console:[], failures:[]};
record.sourceSha256={};
for(const file of ['public/worker.js','public/lsp-client.js','public/jar-transport.js','public/fixtures.js','java/BrowserJarLauncher.java']) {
  record.sourceSha256[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
}
page.on('console', m => { record.console.push({type:m.type(), text:m.text()}); if (m.type()==='error') console.log('Browser:',m.text().slice(0,400)); });
page.on('requestfailed', r => record.failures.push({url:r.url(),error:r.failure()}));
let previousCount=0;
try {
  await page.goto(`http://127.0.0.1:4317/?mode=${mode}&java=${version}&${options}`);
  await page.evaluate(() => window.startProbe());
  const start = Date.now();
  while (Date.now()-start < timeout) {
    const probe = await page.evaluate(() => window.probe);
    record.events = probe.events;
    for (const event of record.events.slice(previousCount)) console.log(JSON.stringify(event).slice(0,1800));
    previousCount = record.events.length;
    if (probe.done) { record.finished=true; break; }
    await new Promise(r=>setTimeout(r,1000));
  }
  if (!record.finished) record.timeout=true;
  record.mainThreadResponsive = await page.evaluate(() => document.title);
  record.uiHeartbeat=await page.evaluate(()=>window.probe.heartbeat);
  await page.screenshot({path:results+reportName+'.png',fullPage:true});
} catch (error) { record.error=String(error); }
finally {
  record.ended=new Date().toISOString();
  const samples=record.events.filter(e=>e.type==='completion');
  const warm=samples.filter(e=>e.repeat).map(e=>e.elapsedMs).sort((a,b)=>a-b);
  record.summary={initializationMs:record.events.find(e=>e.type==='initialized')?.ms, firstCompletionMs:samples[0]?.elapsedMs,passed:samples.filter(e=>e.passed).length,total:samples.length,warmCount:warm.length,warmMedianMs:warm[Math.floor(warm.length/2)],warmP95Ms:warm[Math.max(0,Math.ceil(warm.length*.95)-1)],warmMaxMs:warm.at(-1)};
  await writeFile(results+reportName+'.json',JSON.stringify(record,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify({finished:record.finished,timeout:record.timeout,error:record.error,summary:record.summary,report:results+reportName+'.json'}));
if (record.timeout || record.error || record.events.some(e=>e.type==='error'||(e.type==='completion'&&!e.passed))) process.exitCode=1;
