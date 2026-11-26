import {isRemoteJudgeId} from './client.mjs';
const terminal=new Set(['complete','unknown','failed']);
const allowedOrigins=new Set(['http://127.0.0.1:4318','http://localhost:4318']);
const recordPrefix='job:';
const authWindowKey='ui:authWindow';
function clampInt(value,fallback,min,max){return Number.isFinite(value)?Math.min(max,Math.max(min,Math.round(value))):fallback;}
export function checkSender(sender){
  let url;try{url=new URL(sender.url);}catch{throw new Error('Untrusted caller');}
  if(!allowedOrigins.has(url.origin)||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||sender.tab?.incognito)throw new Error('Untrusted caller');
}
export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function string(value,max,name){if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value).length>max)throw new Error('Invalid '+name);return value;}
function slug(value){string(value,160,'problem');if(!/^[a-z0-9-]+$/.test(value))throw new Error('Invalid problem');return value;}
function key(value){string(value,100,'request ID');if(!/^[\w-]{16,100}$/.test(value))throw new Error('Invalid request ID');return value;}
function select(value,keys){return Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));}
const resultKeys=['state','status_code','status_msg','status_message','correct_answer','code_answer','expected_code_answer','total_correct','total_testcases','status_runtime','status_memory','full_compile_error','compile_error','full_runtime_error','runtime_error','last_testcase','expected_output','std_output','elapsed_time','task_finish_time'];

export class Bridge {
  queue=Promise.resolve();
  constructor({client,storage,windows,tabs}){this.client=client;this.storage=storage;this.windows=windows;this.tabs=tabs;}
  dispatch(message,sender){
    try{checkSender(sender);}catch(error){return Promise.reject(error);}
    if(!message||message.protocol!==1||typeof message.op!=='string'||JSON.stringify(message).length>250000)return Promise.reject(new Error('Invalid extension message'));
    // Serialize operations so concurrent Run/Submit requests cannot race the journal.
    const promise=this.queue.then(()=>this.handle(message,sender));this.queue=promise.catch(()=>{});return promise;
  }
  async save(job){await this.storage.set({[recordPrefix+job.id]:job});return job;}
  async read(id){key(id);const data=await this.storage.get(recordPrefix+id);if(!data[recordPrefix+id])throw new Error('Unknown request ID');return data[recordPrefix+id];}
  async auth(){
    const status=await this.client.status();
    if(!status?.isSignedIn){
      const err=new Error('Sign in to LeetCode in this browser, then return here to reconnect.');
      err.code='SIGNED_OUT';
      throw err;
    }
    return status;
  }
  async openAuthWindow(args={},sender){
    const url=args.mode==='verify'?'https://leetcode.com/':args.mode==='login'?'https://leetcode.com/accounts/login/':null;
    if(!url)throw new Error('Invalid auth window mode');
    if(!this.windows?.create)throw new Error('Popup window management unavailable');
    const existing=(await this.storage.get(authWindowKey))?.[authWindowKey];
    if(Number.isInteger(existing?.windowId)&&existing.mode===args.mode&&this.windows.update){
      try{
        await this.windows.update(existing.windowId,{focused:true});
        await this.storage.set({[authWindowKey]:{...existing,callerWindowId:sender?.tab?.windowId,callerTabId:sender?.tab?.id}});
        return {opened:true,reused:true};
      }catch{}
    }
    if(Number.isInteger(existing?.windowId)&&this.windows.remove){
      try{await this.windows.remove(existing.windowId);}catch{}
    }
    const created=await this.windows.create({
      url,
      type:'popup',
      focused:true,
      width:clampInt(args.width,520,360,900),
      height:clampInt(args.height,700,420,1000),
      left:clampInt(args.left,120,0,10000),
      top:clampInt(args.top,80,0,10000)
    });
    if(Number.isInteger(created?.id)){
      await this.storage.set({[authWindowKey]:{windowId:created.id,mode:args.mode,callerWindowId:sender?.tab?.windowId,callerTabId:sender?.tab?.id}});
    }
    return {opened:true,reused:false};
  }
  async closeAuthWindow(sender){
    const existing=(await this.storage.get(authWindowKey))?.[authWindowKey];
    if(!existing)return {closed:false};
    await this.storage.set({[authWindowKey]:null});
    let closed=false;
    if(Number.isInteger(existing.windowId)&&this.windows?.remove){
      try{await this.windows.remove(existing.windowId);closed=true;}catch{}
    }
    if(closed){
      const targetWindowId=sender?.tab?.windowId??existing.callerWindowId;
      const targetTabId=sender?.tab?.id??existing.callerTabId;
      if(Number.isInteger(targetWindowId)&&this.windows?.update){try{await this.windows.update(targetWindowId,{focused:true});}catch{}}
      if(Number.isInteger(targetTabId)&&this.tabs?.update){try{await this.tabs.update(targetTabId,{active:true});}catch{}}
    }
    return {closed};
  }
  onSessionCookieDetected(){
    const promise=this.queue.then(async()=>{
      const existing=(await this.storage.get(authWindowKey))?.[authWindowKey];
      if(!Number.isInteger(existing?.windowId))return {closed:false};
      const raw=await this.client.status();
      if(!raw?.isSignedIn)return {closed:false};
      return this.closeAuthWindow();
    });
    this.queue=promise.catch(()=>{});
    return promise;
  }
  async handle({op,args={}},sender){
    if(op==='ping')return {protocol:1,transport:'extension-service-worker',requiresLeetCodeTab:false};
    if(op==='openAuthWindow')return this.openAuthWindow(args,sender);
    if(op==='closeAuthWindow')return this.closeAuthWindow(sender);
    if(op==='status'){
      const raw=await this.client.status();
      const info=select(raw,['isSignedIn','username','isPremium']);
      const signedIn=Boolean(info.isSignedIn);
      if(signedIn)await this.closeAuthWindow(sender);
      return {...info,isSignedIn:signedIn,state:signedIn?'ready':'signed-out',loginUrl:'https://leetcode.com/accounts/login/'};
    }
    if(op==='list'){
      const {skip=0,limit=10,search='',difficulty='',tag='',orderBy=''}=args;
      if(!Number.isInteger(skip)||skip<0||!Number.isInteger(limit)||limit<1||limit>100||typeof search!=='string'||search.length>100||!['','EASY','MEDIUM','HARD'].includes(difficulty)||typeof tag!=='string'||(tag&&!/^[a-z0-9-]{1,80}$/.test(tag))||!['','AC_RATE_DESC','AC_RATE_ASC'].includes(orderBy))throw new Error('Invalid search filters');
      return this.client.list({skip,limit,search,difficulty,tag,orderBy});
    }
    if(op==='problem')return this.client.problem(slug(args.slug));
    if(op==='start')return this.start(args);
    if(op==='job')return this.poll(args.id);
    if(op==='verify')return this.verify(args.id);
    if(op==='recent'){
      const account=await this.auth();
      return Object.entries(await this.storage.get(null)).filter(([k,v])=>k.startsWith(recordPrefix)&&v.account===account.username).map(([,v])=>v).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20);
    }
    throw new Error('Unsupported extension operation');
  }
  async start({kind,slug:problemSlug,code,input,idempotencyKey,lang='java'}){
    if(!['run','submit'].includes(kind))throw new Error('Invalid judge operation');
    if(!['java','cpp'].includes(lang))throw new Error('Unsupported language');
    slug(problemSlug);string(code,100000,'source');key(idempotencyKey);
    if(kind==='run'&&input!==undefined)string(input,100000,'test input');
    const fpPayload={kind,slug:problemSlug,code,input:kind==='run'?input:undefined};
    if(lang!=='java')fpPayload.lang=lang;
    const fingerprint=await hash(JSON.stringify(fpPayload));
    const records=await this.storage.get(null),existing=records[recordPrefix+idempotencyKey];
    const account=await this.auth();
    if(existing){
      if(existing.account!==account.username||existing.fingerprint!==fingerprint)throw new Error('Request ID already belongs to another account or snapshot');
      if(existing.state==='sending'){existing.state='unknown';existing.error='The previous request was interrupted. Check LeetCode before sending a new attempt.';await this.save(existing);}
      return existing;
    }
    if(Object.values(records).some(j=>j.account===account.username&&j.state==='judging'))throw new Error('Finish checking the active judge request first.');
    if(Object.keys(records).filter(k=>k.startsWith(recordPrefix)).length>=100)throw new Error('The local extension journal is full. Export your results before clearing extension data.');
    const problem=await this.client.problem(problemSlug);
    const starter=lang==='cpp'?problem.cppStarter:problem.javaStarter;
    if(problem.locked||!starter)throw new Error(`This account cannot access a ${lang==='cpp'?'C++':'Java'} starter for this problem.`);
    const testInput=kind==='run'?(input??problem.exampleInputs.raw):undefined;
    if(kind==='run')string(testInput,100000,'test input');
    const job={id:idempotencyKey,fingerprint,account:account.username,kind,lang,slug:problemSlug,title:problem.title,questionId:problem.questionId,sourceSha256:await hash(code),sourceBytes:new TextEncoder().encode(code).length,inputSha256:testInput?await hash(testInput):undefined,createdAt:new Date().toISOString(),state:'sending',remoteId:null};
    await this.save(job); // Journal before POST; never automatically replay a write.
    try{
      const response=await this.client.execute(kind,problem,code,testInput,lang);
      const id=kind==='run'?response.interpret_id:response.submission_id;
      if(response.error)throw new Error(/too soon|too many|wait|rate limit/i.test(String(response.error))?'LeetCode asked us to wait before starting another judge request.':'LeetCode returned an error instead of a judge job.');
      if(id===undefined||id===null)throw new Error('LeetCode did not return a judge ID.');
      if(!isRemoteJudgeId(id))throw new Error('LeetCode returned an unsupported judge ID format.');
      job.remoteId=String(id);job.state='judging';
      if(kind==='submit')job.url=`https://leetcode.com/problems/${problemSlug}/submissions/${id}/`;
    }catch(error){job.state='unknown';job.error=error.message+' The request was not retried.';}
    return this.save(job);
  }
  async owned(id){const job=await this.read(id),account=await this.auth();if(job.account!==account.username)throw new Error('This result belongs to a different LeetCode account.');return job;}
  async poll(id){
    const job=await this.owned(id);
    if(terminal.has(job.state))return job;
    if(!job.remoteId){job.state='unknown';job.error='The action was interrupted before its ID was saved. Check LeetCode before retrying.';return this.save(job);}
    const raw=await this.client.result(job.remoteId),result=select(raw,resultKeys);
    if(['SUCCESS','FAILURE'].includes(result.state)){
      job.state='complete';job.completedAt=new Date().toISOString();job.result=result;
      job.summary={verdict:job.kind==='run'&&result.correct_answer===false?'Wrong Answer':result.status_msg||result.status_message||result.state};
      return this.save(job);
    }
    return {...job,judgeState:result.state};
  }
  async verify(id){
    const job=await this.owned(id);
    if(job.kind!=='submit'||job.state!=='complete')throw new Error('Wait for a completed submission before verifying its source.');
    const remote=await this.client.submission(job.remoteId);
    const remoteHash=await hash(string(remote.code,100000,'stored source'));
    job.sourceVerification={matches:remoteHash===job.sourceSha256,questionMatches:String(remote.question?.questionId)===String(job.questionId),remoteSha256:remoteHash,language:remote.lang?.name,statusCode:remote.statusCode};
    return this.save(job);
  }
}
