// Only this module touches browser cookies. The login cookie is never read;
// Chromium attaches it to credentialed requests to LeetCode itself.
import {isRemoteJudgeId} from './client.mjs';
function bridgeError(code,message){const e=new Error(message);e.code=code;return e;}
export class BrowserSession {
  // Keep native fetch bound to its worker global; calling a detached Web API as
  // this.fetcher(...) can otherwise trigger an illegal-invocation brand check.
  constructor({cookies,fetcher=(...args)=>fetch(...args),judgeHeaders}){this.cookies=cookies;this.fetcher=fetcher;this.judgeHeaders=judgeHeaders;}
  async hasCsrfCookie(){
    try{return Boolean((await this.cookies.get({url:'https://leetcode.com/',name:'csrftoken'}))?.value);}
    catch{return false;}
  }
  async diagnostics(){
    const query='query { userStatus { isSignedIn } }';
    const probes=[
      {name:'GraphQL GET',url:'https://leetcode.com/graphql/?query='+encodeURIComponent(query),method:'GET',headers:{Accept:'application/json'}},
      {name:'GraphQL POST',url:'https://leetcode.com/graphql/',method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({query})}
    ];
    const results=[];
    for(const {name,url,...options} of probes){
      try{
        const r=await this.fetcher(url,{...options,credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
        const result={name,status:r.status,type:r.headers.get('content-type')};
        if(result.type?.includes('json')){const data=await r.json();result.signedIn=data.data?.userStatus?.isSignedIn;result.graphqlErrors=!!data.errors;}
        results.push(result);
      }catch(error){results.push({name,error:error.name,message:['Illegal invocation','Failed to fetch','Load failed','NetworkError when attempting to fetch resource.'].includes(error.message)?error.message:'Network request failed'});}
    }
    return results;
  }
  async judgeDiagnostics(){
    // Deliberately incomplete payloads check request validation, not execution.
    // No source, language, question ID, or executable test input is sent.
    const results=[];
    for(const operation of ['interpret_solution','submit']){
      try{
        await this.request(`/problems/two-sum/${operation}/`,{method:'POST',body:{},authenticated:true});
        results.push({operation,result:'Unexpected success for an empty diagnostic payload'});
      }catch(error){results.push({operation,error:error.message});}
    }
    return results;
  }
  async request(endpoint,{method='GET',body,authenticated=false}={}){
    const resultPath=/^\/submissions\/detail\/([^/]+)\/check\/$/.exec(endpoint);
    const allowed=endpoint==='/graphql/'||/^\/problems\/[a-z0-9-]+\/(interpret_solution|submit)\/$/.test(endpoint)||(resultPath&&isRemoteJudgeId(resultPath[1]));
    if(!allowed)throw new Error('Unsupported LeetCode operation');
    const headers={Accept:'application/json'};
    if(method==='POST'){
      headers['Content-Type']='application/json';
      const csrf=await this.cookies.get({url:'https://leetcode.com/',name:'csrftoken'});
      if(csrf?.value)headers['x-csrftoken']=csrf.value;
      else if(authenticated)throw bridgeError('CSRF_MISSING','Your LeetCode session needs refreshing. Sign in normally, then close that tab and reconnect.');
    }
    let response;
    try{
      const send=()=>this.fetcher('https://leetcode.com'+endpoint,{method,headers,body:body?JSON.stringify(body):undefined,credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
      response=await (this.judgeHeaders?this.judgeHeaders.run(endpoint,method,send):send());
    }catch{throw bridgeError('NETWORK_ERROR','LeetCode did not complete the request. Check your connection or session; no automatic retry was performed.');}
    if(!response.ok){
      const detail=await rejectionDetail(response);
      const code=response.status===429?'RATE_LIMITED':/browser-verification/i.test(detail)?'VERIFICATION_REQUIRED':/authentication|CSRF/i.test(detail)?'SIGNED_OUT':'HTTP_ERROR';
      throw bridgeError(code,`LeetCode returned HTTP ${response.status}. ${detail}`);
    }
    if(!response.headers.get('content-type')?.includes('application/json'))throw bridgeError('VERIFICATION_REQUIRED','LeetCode returned a verification page instead of data. Open LeetCode normally to refresh the session.');
    // Do not expose response headers, redirects, cookies, or non-JSON challenge pages.
    return response.json();
  }
}

// Classify errors inside the worker. Never export raw bodies, cookie values,
// server-provided messages, headers, or challenge tokens to the app/journal.
export async function rejectionDetail(response){
  let body='';
  try{
    const reader=response.body?.getReader(),decoder=new TextDecoder();
    if(reader){
      let bytes=0;
      try{
        while(bytes<8192){
          const {done,value}=await reader.read();if(done)break;
          const part=value.subarray(0,8192-bytes);bytes+=part.length;body+=decoder.decode(part,{stream:true});
        }
        body+=decoder.decode();
      }finally{await reader.cancel();}
    }
  }catch{return 'The rejection body could not be inspected.';}
  if(!body.trim())return 'The response body was empty.';
  if(/referer checking failed|no referer|missing referer/i.test(body))return 'The response reports a missing or rejected Referer.';
  if(/origin checking failed|invalid origin|origin mismatch/i.test(body))return 'The response reports a rejected Origin.';
  if(/csrf.{0,80}(incorrect|missing|failed|invalid|mismatch)|(?:invalid|missing).{0,30}csrf/i.test(body))return 'The response reports a CSRF validation failure.';
  if(/just a moment|cf-chl-|challenges\.cloudflare\.com|verify you are human/i.test(body))return 'The response is a browser-verification challenge.';
  if(/not (?:logged|signed) in|authentication (?:required|failed)|login required/i.test(body))return 'The response reports that authentication is required.';
  if(response.status===429)return 'The service rate limited the request.';
  const format=response.headers.get('content-type')?.includes('json')?'JSON':'non-JSON';
  return `The service returned an unclassified ${format} rejection; response body omitted.`;
}
