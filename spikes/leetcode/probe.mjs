import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

// Bounded, read-only upstream checks. This probe never runs or submits code.
const origin='http://127.0.0.1:4318';
const checks=[];
async function get(path){const response=await fetch(origin+path);assert.equal(response.status,200,path);return response.json();}
function check(name,test,details={}){assert.ok(test,name);checks.push({name,passed:true,...details});}
const config=await get('/api/config');
assert.equal(config.mode,'extension','Run the default server for this probe');
const first=await get('/api/problems?limit=5');
const next=await get('/api/problems?limit=5&skip=5');
check('Pagination',first.questions.length===5&&next.questions.length===5&&!next.questions.some(q=>first.questions.some(p=>q.titleSlug===p.titleSlug)),{total:first.totalNum});
const filtered=await get('/api/problems?limit=5&difficulty=EASY');
check('Difficulty filter',filtered.questions.length>0&&filtered.questions.every(q=>q.difficulty==='Easy'));
const searched=await get('/api/problems?limit=5&search=two%20sum');
check('Search',searched.questions.some(q=>q.titleSlug==='two-sum'));
const problem=await get('/api/problems/two-sum');
check('Description and Java starter',!!problem.content&&problem.javaStarter.includes('int[] twoSum'));
check('All default example cases',problem.exampleInputs.cases.length===3&&problem.exampleInputs.raw==='[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6');
const blocked=await fetch(origin+'/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
check('Backend rejects judge writes and credential bodies',blocked.status===405);
const disconnected=await fetch(origin+'/api/connect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
check('Backend has no login connection endpoint',disconnected.status===405);
const premium=await get('/api/problems/meeting-rooms');
check('Premium access remains locked when signed out',premium.isPaidOnly&&premium.locked&&!premium.content&&!premium.javaStarter);
const report={recordedAt:new Date().toISOString(),kind:'Public reads and local request guards',checks,authenticatedRun:'See separate browser-checks.json',authenticatedSubmission:'See separate browser-checks.json'};
await mkdir(new URL('./results/',import.meta.url),{recursive:true});
await writeFile(new URL('./results/public-checks.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
