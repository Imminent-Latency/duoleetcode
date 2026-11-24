import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Bridge,hash} from '../extension/bridge.mjs';
import {BrowserSession,rejectionDetail} from '../extension/browser-session.mjs';
import {JudgeHeaders,judgeHeaderRule} from '../extension/judge-headers.mjs';
import {LeetCodeClient,isRemoteJudgeId} from '../client.mjs';
const sender={url:'http://127.0.0.1:4318/',frameId:0,tab:{id:1,incognito:false}};
const args={kind:'submit',slug:'two-sum',code:'class Solution {}',idempotencyKey:'test-0000000000000001'};
function setup(overrides={}){
  let records={},writes=0;
  const storage={get:async key=>structuredClone(key?{[key]:records[key]}:records),set:async value=>{Object.assign(records,structuredClone(value));}};
  const client={status:async()=>({isSignedIn:true,username:'fixture',isPremium:true}),problem:async()=>({questionId:'1',title:'Two Sum',javaStarter:'class Solution {}',exampleInputs:{raw:'[2,7]\n9'},locked:false}),execute:async()=>{writes++;return {submission_id:123,interpret_id:'run-123'};},result:async()=>({state:'SUCCESS',status_code:10,status_msg:'Accepted',total_correct:66,total_testcases:66,credentials:'must-not-leak'}),submission:async()=>({code:args.code,question:{questionId:'1'},lang:{name:'Java'},statusCode:10}),...overrides};
  const bridge=new Bridge({client,storage});
  return {bridge,client,storage,dispatch:(op,input=args,from=sender)=>bridge.dispatch({protocol:1,op,args:input},from),writes:()=>writes,records:()=>records};
}
test('rejects other sites, ports, embedded frames, and incognito callers before I/O',async()=>{
  const s=setup({status:()=>assert.fail('must not call account')});
  for(const from of [{...sender,url:'https://evil.test/'},{...sender,url:'http://127.0.0.1:9999/'},{...sender,frameId:2},{...sender,tab:{id:1,incognito:true}}])await assert.rejects(s.dispatch('status',{},from),/Untrusted/);
});
test('does not expose generic URL, GraphQL, cookie or header operations',async()=>{
  const s=setup();for(const op of ['fetch','graphql','cookies','headers'])await assert.rejects(s.dispatch(op),/Unsupported/);
});
test('concurrent repeated submission is sent once; different snapshot with same key fails',async()=>{
  const s=setup(),[a,b]=await Promise.all([s.dispatch('start'),s.dispatch('start')]);assert.equal(a.remoteId,b.remoteId);assert.equal(s.writes(),1);
  await assert.rejects(s.dispatch('start',{...args,code:'different'}),/another account or snapshot/);
});
test('restart reuses saved judge ID without resubmitting',async()=>{
  const s=setup();await s.dispatch('start');const resumed=new Bridge(s);
  const job=await resumed.dispatch({protocol:1,op:'start',args},sender);assert.equal(job.remoteId,'123');assert.equal(s.writes(),1);
});
test('unknown POST outcome stays unknown after repeat, never automatically resubmits',async()=>{
  let calls=0;const s=setup({execute:async()=>{calls++;throw new Error('Connection dropped');}});
  assert.equal((await s.dispatch('start')).state,'unknown');assert.equal((await s.dispatch('start')).state,'unknown');assert.equal(calls,1);
});
test('interrupted journal with no remote ID is never replayed',async()=>{
  const s=setup();await s.storage.set({['job:'+args.idempotencyKey]:{...args,id:args.idempotencyKey,account:'fixture',state:'sending',fingerprint:await hash(JSON.stringify({kind:args.kind,slug:args.slug,code:args.code}))}});
  assert.equal((await s.dispatch('start')).state,'unknown');assert.equal(s.writes(),0);
});
test('signed-out, locked, and invalid requests cannot reach the judge',async()=>{
  for(const overrides of [{status:async()=>({isSignedIn:false})},{problem:async()=>({locked:true})}]){const s=setup(overrides);await assert.rejects(s.dispatch('start'));assert.equal(s.writes(),0);}
  const s=setup();await assert.rejects(s.dispatch('start',{...args,slug:'../../account'}));await assert.rejects(s.dispatch('start',{...args,code:'x'.repeat(100001)}));assert.equal(s.writes(),0);
});
test('normalizes wrong answers and returns only allowed judge fields',async()=>{
  const s=setup({result:async()=>({state:'SUCCESS',status_code:10,status_msg:'Accepted',correct_answer:false,cookies:'must-not-leak'})});
  const job=await s.dispatch('start',{...args,kind:'run'});const result=await s.dispatch('job',{id:job.id});assert.equal(result.summary.verdict,'Wrong Answer');assert.equal(result.result.cookies,undefined);
});
test('verifies stored source against frozen snapshot, detects a mismatch',async()=>{
  const s=setup();await s.dispatch('start');await s.dispatch('job',{id:args.idempotencyKey});assert.equal((await s.dispatch('verify',{id:args.idempotencyKey})).sourceVerification.matches,true);
  s.client.submission=async()=>({code:'different',question:{questionId:'1'}});assert.equal((await s.dispatch('verify',{id:args.idempotencyKey})).sourceVerification.matches,false);
  assert.equal(JSON.stringify(s.records()).includes(args.code),false);
});
test('uses automatic credentials; reads only CSRF locally, never returns headers',async()=>{
  const reads=[],requests=[];const session=new BrowserSession({cookies:{get:async details=>{reads.push(details);return {value:'local-csrf-secret'};}},fetcher:async(url,options)=>{requests.push({url,options});return Response.json({data:{ok:true}},{headers:{'set-cookie':'secret-cookie'}});}});
  const result=await session.request('/problems/two-sum/submit/',{method:'POST',authenticated:true,body:{lang:'java'}});
  assert.deepEqual(reads,[{url:'https://leetcode.com/',name:'csrftoken'}]);assert.equal(requests[0].options.credentials,'include');assert.equal(requests[0].options.headers.Cookie,undefined);assert.equal(requests[0].options.headers['x-csrftoken'],'local-csrf-secret');assert.equal(JSON.stringify(result).includes('secret'),false);
  await assert.rejects(session.request('https://evil.test'));await assert.rejects(session.request('/accounts/'));
});
test('does not leak challenge bodies or auto-retry rejected requests',async()=>{
  let calls=0;const session=new BrowserSession({cookies:{get:async()=>null},fetcher:async()=>{calls++;return new Response('private challenge data',{status:403});}});
  await assert.rejects(session.request('/graphql/'),error=>error.message.includes('403')&&!error.message.includes('private'));assert.equal(calls,1);
});
test('calls native fetch with its global receiver rather than the session object',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=function(){assert.ok(this===undefined||this===globalThis,'fetch receiver must be its global context');return Promise.resolve(Response.json({data:{ok:true}}));};
    const session=new BrowserSession({cookies:{get:async()=>null}});
    assert.deepEqual(await session.request('/graphql/'),{data:{ok:true}});
  }finally{globalThis.fetch=original;}
});
test('classifies rejection reasons without returning raw bodies or server secrets',async()=>{
  for(const [body,expected] of [
    ['CSRF Failed: Referer checking failed - no Referer. token=secret','Referer'],
    ['Origin checking failed: chrome-extension://private-id','Origin'],
    ['CSRF token missing or incorrect: private-token','CSRF'],
    ['<title>Just a moment...</title> secret-challenge','browser-verification'],
    ['Authentication required private-cookie','authentication'],
    ['private unknown payload','unclassified'],
    ['', 'empty']
  ]){
    const detail=await rejectionDetail(new Response(body,{status:499}));
    assert.ok(detail.includes(expected),detail);assert.doesNotMatch(detail,/secret|private|chrome-extension/);
  }
});
test('judge diagnostics send no executable payload and never repeat a rejected POST',async()=>{
  const requests=[];
  const session=new BrowserSession({cookies:{get:async()=>({value:'private-csrf'})},fetcher:async(url,options)=>{
    requests.push({url,options});return new Response('CSRF verification failed private-secret',{status:499});
  }});
  const result=await session.judgeDiagnostics();assert.equal(requests.length,2);
  for(const {url,options} of requests){assert.match(url,/two-sum\/(interpret_solution|submit)\/$/);assert.deepEqual(JSON.parse(options.body),{});}
  assert.ok(result.every(r=>r.error.includes('CSRF')));assert.doesNotMatch(JSON.stringify(result),/private/);
});
test('package has no tabs/offscreen/content script capability and only LeetCode network access',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['cookies','storage','declarativeNetRequestWithHostAccess']);assert.deepEqual(manifest.host_permissions,['https://leetcode.com/*']);assert.equal(manifest.content_scripts,undefined);
});
const fixtureExtensionId='a'.repeat(32);
test('judge header rules cannot affect other sites, tabs, operations or methods',()=>{
  const rule=judgeHeaderRule('/problems/two-sum/submit/',fixtureExtensionId);
  assert.deepEqual(rule.condition,{urlFilter:'|https://leetcode.com/problems/two-sum/submit/|',initiatorDomains:[fixtureExtensionId],requestMethods:['post'],resourceTypes:['xmlhttprequest']});
  assert.deepEqual(rule.action.requestHeaders,[{header:'Origin',operation:'set',value:'https://leetcode.com'},{header:'Referer',operation:'set',value:'https://leetcode.com/problems/two-sum/'}]);
  for(const endpoint of ['/graphql/','/accounts/','/problems/../submit/','https://evil.test/','/problems/two-sum/submit/?other=1'])assert.throws(()=>judgeHeaderRule(endpoint,fixtureExtensionId));
  assert.throws(()=>judgeHeaderRule('/problems/two-sum/submit/','evil.test'));
});
test('judge header scopes serialize concurrent calls and clean up after rejection',async()=>{
  const events=[];
  const headers=new JudgeHeaders({extensionId:fixtureExtensionId,netRequest:{updateSessionRules:async update=>{events.push(update.addRules?'install':'remove');}}});
  await Promise.allSettled([
    headers.run('/problems/two-sum/submit/','POST',async()=>{events.push('submit');throw new Error('rejected');}),
    headers.run('/problems/two-sum/interpret_solution/','POST',async()=>events.push('run'))
  ]);
  assert.deepEqual(events,['install','submit','remove','install','run','remove']);
  await headers.run('/graphql/','POST',async()=>events.push('graphql'));
  await headers.run('/problems/two-sum/submit/','GET',async()=>events.push('get'));
  assert.deepEqual(events.slice(6),['graphql','get']);
});
test('header cleanup failure preserves the already received submission ID',async()=>{
  const headers=new JudgeHeaders({extensionId:fixtureExtensionId,netRequest:{updateSessionRules:async update=>{if(!update.addRules)throw new Error('worker cleanup interrupted');}}});
  assert.deepEqual(await headers.run('/problems/two-sum/submit/','POST',async()=>({submission_id:123})),{submission_id:123});
  assert.equal(headers.cleanupFailed,true);
});
test('fractional Run IDs survive journaling and poll through the real client and URL allowlist',async()=>{
  const id='runcode_1627219627.5662382_EI7iasnhLm';
  const s=setup({execute:async()=>({interpret_id:id})});
  const job=await s.dispatch('start',{...args,kind:'run'});assert.equal(job.remoteId,id);assert.equal(job.state,'judging');
  const requested=[];
  const session=new BrowserSession({cookies:{get:async()=>null},fetcher:async url=>{requested.push(url);return Response.json({state:'SUCCESS',correct_answer:true});}});
  const client=new LeetCodeClient(session);
  assert.equal((await client.result(job.remoteId)).correct_answer,true);
  assert.deepEqual(requested,[`https://leetcode.com/submissions/detail/${id}/check/`]);
  for(const bad of ['..','a/../../accounts','x?next=account','x#fragment','a..b','%2e%2e','x'.repeat(201)]){
    assert.equal(isRemoteJudgeId(bad),false);
    await assert.rejects(client.result(bad));
    await assert.rejects(session.request(`/submissions/detail/${bad}/check/`));
  }
  assert.equal(requested.length,1);
});
test('HTTP-success error payloads remain non-retriable and do not leak their contents',async()=>{
  const s=setup({execute:async()=>({error:'Run code too soon. private-server-data'})});
  const job=await s.dispatch('start',{...args,kind:'run'});
  assert.equal(job.state,'unknown');assert.match(job.error,/wait/);assert.doesNotMatch(job.error,/private/);
});
test('status reports explicit ready or signed-out state with loginUrl and structured error codes',async()=>{
  const ready=setup();
  assert.deepEqual(await ready.dispatch('status',{}),{isSignedIn:true,username:'fixture',isPremium:true,state:'ready',loginUrl:'https://leetcode.com/accounts/login/'});
  const signedOut=setup({status:async()=>({isSignedIn:false})});
  assert.deepEqual(await signedOut.dispatch('status',{}),{isSignedIn:false,state:'signed-out',loginUrl:'https://leetcode.com/accounts/login/'});
  await assert.rejects(signedOut.dispatch('recent',{}),err=>err.code==='SIGNED_OUT');

  const withCookie=new BrowserSession({cookies:{get:async()=>({value:'secret-csrf-value'})},fetcher:async()=>Response.json({ok:true})});
  assert.equal(await withCookie.hasCsrfCookie(),true);
  const withoutCookie=new BrowserSession({cookies:{get:async()=>null},fetcher:async()=>Response.json({ok:true})});
  assert.equal(await withoutCookie.hasCsrfCookie(),false);
  await assert.rejects(withoutCookie.request('/problems/two-sum/submit/',{method:'POST',authenticated:true,body:{}}),err=>err.code==='CSRF_MISSING');

  const rateLimited=new BrowserSession({cookies:{get:async()=>null},fetcher:async()=>new Response('slow down',{status:429})});
  await assert.rejects(rateLimited.request('/graphql/'),err=>err.code==='RATE_LIMITED');
  const challenge=new BrowserSession({cookies:{get:async()=>null},fetcher:async()=>new Response('<title>Just a moment...</title>',{status:403})});
  await assert.rejects(challenge.request('/graphql/'),err=>err.code==='VERIFICATION_REQUIRED');
});
test('extension-managed auth popup opens only fixed LeetCode URLs and auto-closes only its own window on login',async()=>{
  let records={},signedIn=false,nextWinId=70;
  const created=[],removed=[],focusedWindows=[],activatedTabs=[];
  const storage={get:async key=>structuredClone(key?{[key]:records[key]}:records),set:async value=>{Object.assign(records,structuredClone(value));}};
  const client={status:async()=>signedIn?{isSignedIn:true,username:'ldev',isPremium:false}:{isSignedIn:false}};
  const windows={
    create:async opts=>{const id=++nextWinId;created.push({id,...opts});return {id};},
    update:async(id,opts)=>{focusedWindows.push({id,...opts});return {id};},
    remove:async id=>{removed.push(id);}
  };
  const tabs={update:async(id,opts)=>{activatedTabs.push({id,...opts});return {id};}};
  const bridge=new Bridge({client,storage,windows,tabs});
  const caller={url:'http://127.0.0.1:4318/',frameId:0,tab:{id:9,windowId:3,incognito:false}};

  await assert.rejects(bridge.dispatch({protocol:1,op:'openAuthWindow',args:{mode:'https://evil.test'}},caller),/Invalid auth window mode/);
  await assert.rejects(bridge.dispatch({protocol:1,op:'openAuthWindow',args:{mode:'login'}},{...caller,url:'https://evil.test/'}),/Untrusted/);

  const first=await bridge.dispatch({protocol:1,op:'openAuthWindow',args:{mode:'login',width:520,height:700,left:200,top:100}},caller);
  assert.deepEqual(first,{opened:true,reused:false});
  assert.equal(created.length,1);
  assert.equal(created[0].url,'https://leetcode.com/accounts/login/');
  assert.equal(created[0].type,'popup');

  const second=await bridge.dispatch({protocol:1,op:'openAuthWindow',args:{mode:'login'}},caller);
  assert.deepEqual(second,{opened:true,reused:true});
  assert.equal(created.length,1);

  // While still signed out, cookie check does not close the popup.
  assert.deepEqual(await bridge.onSessionCookieDetected(),{closed:false});
  assert.deepEqual(removed,[]);

  // Once signed in, onSessionCookieDetected closes only that popup window and focuses the caller tab/window.
  signedIn=true;
  assert.deepEqual(await bridge.onSessionCookieDetected(),{closed:true});
  assert.deepEqual(removed,[71]);
  assert.deepEqual(focusedWindows.at(-1),{id:3,focused:true});
  assert.deepEqual(activatedTabs,[{id:9,active:true}]);

  // Subsequent cookie changes with no tracked auth popup never touch any window.
  assert.deepEqual(await bridge.onSessionCookieDetected(),{closed:false});
  assert.deepEqual(removed,[71]);
});
