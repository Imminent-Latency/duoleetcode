import {extensionId} from './extension-config.js';
const $=id=>document.getElementById(id),drafts=new Map();
let connected=false,signedIn=false,busy=false,problem=null,skip=0,total=0,job=null;
let accessReport=null,connectionReport=null,judgeReport=null;
const limit=10;
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
async function api(path){const r=await fetch(path);const value=await r.json();if(!r.ok)throw new Error(value.error||'Local request failed');return value;}
function extension(op,args={}){
  return new Promise((resolve,reject)=>{
    if(!window.chrome?.runtime?.sendMessage)return reject(new Error('Open this app in the regular Chromium browser where the extension is installed.'));
    const timeout=setTimeout(()=>reject(new Error('The extension did not respond. Reconnect or resume the last request; do not resend an uncertain submission.')),60000);
    chrome.runtime.sendMessage(extensionId,{protocol:1,op,args},response=>{
      clearTimeout(timeout);
      const error=chrome.runtime.lastError;
      if(error)return reject(new Error('The DuoLeetCode extension is not available in this browser. Load the extension, then reconnect.'));
      if(!response?.ok)return reject(new Error(response?.error||'The extension could not complete the request'));
      resolve(response.data);
    });
  });
}
function buttons(){
  for(const id of ['run','submit'])$(id).disabled=busy||!connected||!signedIn||!problem||problem.locked||!problem.javaStarter;
  for(const id of ['copy-code','copy-inputs'])$(id).disabled=!problem||problem.locked;
  for(const id of ['fixture','connect','check-access','resume'])$(id).disabled=busy||(id==='check-access'&&!connected)||(id==='resume'&&(!connected||!localStorage.getItem('duoleetcode-last-job')));
}
async function connect(){
  await extension('ping');connected=true;
  const account=await extension('status');signedIn=!!account.isSignedIn;
  $('account').textContent=signedIn?`${account.username}${account.isPremium?' · Premium':''} · background connection`:'Extension connected · LeetCode signed out';
  $('connect').textContent='Reconnect';$('install-help').hidden=true;buttons();
  await list();await load(problem?.titleSlug||'two-sum');
  notice(signedIn?'Connected through the extension. LeetCode tabs can stay closed.':'Sign in to LeetCode in this browser once, close that tab, then reconnect.',!signedIn);
}
async function list(){
  const filters={skip,limit,search:$('search').value,difficulty:$('difficulty').value};
  const result=connected?await extension('list',filters):await api('/api/problems?'+new URLSearchParams(filters));total=result.totalNum;
  $('catalog-count').textContent=`${total.toLocaleString()} results · ${Math.min(skip+1,total)}–${Math.min(skip+limit,total)}${connected?' · via extension':' · public preview'}`;
  $('problems').replaceChildren();
  for(const q of result.questions){
    const button=document.createElement('button');button.dataset.slug=q.titleSlug;button.textContent=`${q.questionFrontendId}. ${q.title}`;
    const meta=document.createElement('small');meta.textContent=[q.difficulty,q.isPaidOnly?'Premium':null,q.status==='ac'?'Solved':null].filter(Boolean).join(' · ');button.append(meta);button.classList.toggle('active',q.titleSlug===problem?.titleSlug);
    button.onclick=()=>load(q.titleSlug).catch(e=>notice(e.message,true));$('problems').append(button);
  }
  $('previous').disabled=skip===0;$('next').disabled=skip+limit>=total;
}
async function load(slug){
  if(problem)drafts.set(problem.titleSlug,{code:$('code').value,inputs:$('inputs').value});
  const next=connected?await extension('problem',{slug}):await api('/api/problems/'+slug);problem=next;
  $('problem-title').textContent=next.questionFrontendId+'. '+next.title;
  $('problem-meta').textContent=[next.difficulty,next.isPaidOnly?'Premium':'Free',...next.topicTags.map(t=>t.name)].join(' · ');
  $('problem-link').href=`https://leetcode.com/problems/${next.titleSlug}/`;
  $('description').srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https://assets.leetcode.com; base-uri 'none'; form-action 'none'"><style>body{color:#d6dfef;background:#151923;font:14px/1.65 system-ui;padding:10px 18px}pre,code{font-family:ui-monospace,monospace}pre{white-space:pre-wrap}img{max-width:100%}</style>`+(next.content||'<p>This problem needs an eligible signed-in account. Connect the extension to use your subscription.</p>');
  const saved=drafts.get(slug);$('code').value=saved?.code??next.javaStarter??'';$('inputs').value=saved?.inputs??next.exampleInputs.raw;
  $('case-count').textContent=next.exampleInputs.cases.length?`${next.exampleInputs.cases.length} example cases`:'Raw LeetCode input format';
  for(const b of $('problems').children)b.classList.toggle('active',b.dataset.slug===slug);
  buttons();
}
function showJob(value){
  job=value;
  $('verdict').textContent=value.summary?.verdict||({sending:'Sending snapshot…',judging:'LeetCode is judging…',unknown:'Outcome unknown — check before retrying',failed:'Request failed'}[value.state]||value.state);
  $('verdict').className=value.result?.status_code===10&&value.result?.correct_answer!==false?'accepted':value.state==='unknown'||value.result?.status_code!==undefined?'rejected':'';
  const count=value.result?.total_testcases!=null?` · ${value.result.total_correct}/${value.result.total_testcases} cases`:'';
  $('job-meta').textContent=`${value.kind==='submit'?'Submission':'Run'} · ${value.title}${count} · source ${value.sourceSha256.slice(0,12)} · ${value.sourceBytes} bytes${value.sourceVerification?.matches&&value.sourceVerification?.questionMatches?' · exact stored source verified':''}`;
  $('submission-link').hidden=!value.url;if(value.url)$('submission-link').href=value.url;
  $('result-detail').textContent=JSON.stringify(value.result?{...value.result,sourceVerification:value.sourceVerification}: {state:value.state,remoteId:value.remoteId,error:value.error},null,2);
  $('job-record').textContent=JSON.stringify(value,null,2);
}
async function monitor(value){
  showJob(value);
  for(let attempt=0;attempt<60&&!['complete','unknown','failed'].includes(job.state);attempt++){
    await new Promise(resolve=>setTimeout(resolve,2000));showJob(await extension('job',{id:value.id}));
  }
  if(job.state==='complete'&&job.kind==='submit'){
    try{showJob(await extension('verify',{id:value.id}));}catch(error){notice(`Accepted result retained; stored-source check failed: ${error.message}`,true);return;}
  }
  notice(job.state==='complete'?'Result received directly through your browser extension.':job.error||'Still judging. Use Resume last request to check this same attempt.',job.state!=='complete');
}
async function execute(kind){
  if(busy)return;busy=true;buttons();
  const id=crypto.randomUUID(),source=$('code').value;
  try{
    localStorage.setItem('duoleetcode-last-job',id);
    const value=await extension('start',{kind,slug:problem.titleSlug,code:source,input:kind==='run'?$('inputs').value:undefined,idempotencyKey:id});
    await monitor(value);
  }catch(error){notice(error.message,true);}
  finally{busy=false;buttons();}
}
async function accessChecks(){
  busy=true;buttons();const report={recordedAt:new Date().toISOString(),transport:'extension-service-worker',requiresLeetCodeTab:false,checks:[]};
  const check=(name,passed,details={})=>{report.checks.push({name,passed,...details});$('access-report').textContent=JSON.stringify(report,null,2);if(!passed)throw new Error(name+' failed');};
  try{
    const status=await extension('status');check('Authenticated account',status.isSignedIn,{username:status.username,isPremium:status.isPremium});
    const first=await extension('list',{limit:5}),second=await extension('list',{limit:5,skip:5});
    check('Catalog and pagination',first.questions.length===5&&second.questions.length===5&&!first.questions.some(a=>second.questions.some(b=>b.titleSlug===a.titleSlug)),{total:first.totalNum});
    const filtered=await extension('list',{limit:5,difficulty:'EASY'});check('Difficulty filter',filtered.questions.length>0&&filtered.questions.every(q=>q.difficulty==='Easy'));
    const search=await extension('list',{limit:5,search:'two sum'});check('Search',search.questions.some(q=>q.titleSlug==='two-sum'));
    const free=await extension('problem',{slug:'two-sum'});check('Description and Java starter',!!free.content&&!!free.javaStarter);check('All three example inputs',free.exampleInputs.cases.length===3&&free.exampleInputs.raw==='[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6');
    const premium=await extension('problem',{slug:'meeting-rooms'});check(status.isPremium?'Premium description, starter and inputs':'Premium remains locked',status.isPremium?!premium.locked&&!!premium.javaStarter&&!!premium.exampleInputs.raw:premium.locked,{slug:'meeting-rooms',exampleCases:premium.exampleInputs.cases.length});
    notice('Problem-access checks passed through the extension. Run and Submit are tested separately below.');
  }catch(error){report.error=error.message;notice(error.message,true);}
  finally{accessReport=report;$('access-report').textContent=JSON.stringify(report,null,2);busy=false;buttons();}
}
$('connect').onclick=()=>connect().catch(e=>{connected=false;signedIn=false;$('account').textContent='Extension disconnected';$('install-help').hidden=false;buttons();notice(e.message,true);});
$('check-access').onclick=accessChecks;
$('diagnostics').onclick=async()=>{try{$('access-report').textContent='Checking background connection…';connectionReport=await extension('diagnostics');$('access-report').textContent=JSON.stringify(connectionReport,null,2);}catch(e){$('access-report').textContent=e.message;}};
$('judge-diagnostics').onclick=async()=>{try{$('access-report').textContent='Checking judge validation with empty requests…';judgeReport=await extension('judgeDiagnostics');$('access-report').textContent=JSON.stringify(judgeReport,null,2);}catch(e){$('access-report').textContent=e.message;}};
$('export-evidence').onclick=async()=>{
  try{
    const evidence={recordedAt:new Date().toISOString(),transport:'extension-service-worker',access:accessReport,connection:connectionReport,judgeConnection:judgeReport,jobs:await extension('recent')};
    const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='duoleetcode-extension-evidence.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice('Test evidence downloaded. It contains results and source hashes, with no login credentials.');
  }catch(e){notice(e.message,true);}
};
$('resume').onclick=async()=>{busy=true;buttons();try{await monitor(await extension('job',{id:localStorage.getItem('duoleetcode-last-job')}));}catch(e){notice(e.message,true);}finally{busy=false;buttons();}};
$('search-form').onsubmit=e=>{e.preventDefault();skip=0;list().catch(e=>notice(e.message,true));};
$('difficulty').onchange=()=>{skip=0;list().catch(e=>notice(e.message,true));};
$('previous').onclick=()=>{skip=Math.max(0,skip-limit);list().catch(e=>notice(e.message,true));};
$('next').onclick=()=>{skip+=limit;list().catch(e=>notice(e.message,true));};
$('fixture').onclick=async()=>{try{const f=await api('/api/fixture');if(problem?.titleSlug!==f.slug)await load(f.slug);$('code').value=f.code;notice('Synthetic Two Sum fixture loaded. Submit creates a real test submission on your account.');}catch(e){notice(e.message,true);}};
$('run').onclick=()=>execute('run');$('submit').onclick=()=>execute('submit');
for(const [button,field] of [['copy-code','code'],['copy-inputs','inputs']])$(button).onclick=async()=>{try{await navigator.clipboard.writeText($(field).value);notice('Copied.');}catch{notice('Select the text and copy it manually.',true);}};
$('code').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();e.target.setRangeText('    ',e.target.selectionStart,e.target.selectionEnd,'end');}});
try{await extension('ping');await connect();}catch{connected=false;buttons();$('account').textContent='Connect your browser extension';await list().then(()=>load('two-sum')).catch(e=>notice(e.message,true));notice('Public preview loaded. Connect the extension for your subscription, Run, and Submit.');}
