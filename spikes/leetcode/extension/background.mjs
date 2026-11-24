import {BrowserSession} from './browser-session.mjs';
import {LeetCodeClient} from './client.mjs';
import {Bridge,checkSender} from './bridge.mjs';
import {JudgeHeaders} from './judge-headers.mjs';

const judgeHeaders=new JudgeHeaders({netRequest:chrome.declarativeNetRequest,extensionId:chrome.runtime.id});
const session=new BrowserSession({cookies:chrome.cookies,judgeHeaders});
const bridge=new Bridge({client:new LeetCodeClient(session),storage:chrome.storage.local,windows:chrome.windows,tabs:chrome.tabs});
chrome.cookies.onChanged.addListener(changeInfo=>{
  // Inspect cookie name and removal flag only; never read or store LEETCODE_SESSION values.
  if(!changeInfo.removed&&changeInfo.cookie?.name==='LEETCODE_SESSION'&&changeInfo.cookie?.domain?.endsWith('leetcode.com')){
    void bridge.onSessionCookieDetected().catch(()=>{});
  }
});
chrome.runtime.onMessageExternal.addListener((message,sender,sendResponse)=>{
  if(message?.protocol===1&&['diagnostics','judgeDiagnostics'].includes(message.op)){
    try{checkSender(sender);}catch{sendResponse({ok:false,error:'Untrusted caller',errorCode:'UNTRUSTED_CALLER'});return false;}
    (async()=>({version:chrome.runtime.getManifest().version,hasCsrfCookie:await session.hasCsrfCookie(),leetcodePermission:await chrome.permissions.contains({origins:['https://leetcode.com/*']}),judgeHeaderPermission:await chrome.permissions.contains({permissions:['declarativeNetRequestWithHostAccess']}),requests:await (message.op==='judgeDiagnostics'?session.judgeDiagnostics():session.diagnostics()),headerCleanupFailed:judgeHeaders.cleanupFailed}))().then(data=>sendResponse({ok:true,data})).catch(()=>sendResponse({ok:false,error:'Could not read extension diagnostics',errorCode:'DIAGNOSTICS_ERROR'}));return true;
  }
  bridge.dispatch(message,sender).then(async data=>{
    if(message?.op==='ping'){
      data={...data,version:chrome.runtime.getManifest().version,hasCsrfCookie:await session.hasCsrfCookie(),leetcodePermission:await chrome.permissions.contains({origins:['https://leetcode.com/*']}),judgeHeaderPermission:await chrome.permissions.contains({permissions:['declarativeNetRequestWithHostAccess']})};
    }
    sendResponse({ok:true,data});
  }).catch(error=>sendResponse({ok:false,error:error.message,errorCode:error.code||(/Untrusted/i.test(error.message)?'UNTRUSTED_CALLER':'BRIDGE_ERROR')}));
  return true;
});
// No content scripts, offscreen documents, tabs, cookie exports, or backend calls.
