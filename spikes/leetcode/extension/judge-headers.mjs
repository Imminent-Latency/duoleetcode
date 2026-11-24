const ruleId=1;
export function judgeHeaderRule(endpoint,extensionId){
  const match=/^\/problems\/([a-z0-9-]+)\/(interpret_solution|submit)\/$/.exec(endpoint);
  if(!match||!/^[a-p]{32}$/.test(extensionId))throw new Error('Unsupported judge header scope');
  return {
    id:ruleId,priority:1,
    action:{type:'modifyHeaders',requestHeaders:[
      {header:'Origin',operation:'set',value:'https://leetcode.com'},
      {header:'Referer',operation:'set',value:`https://leetcode.com/problems/${match[1]}/`}
    ]},
    condition:{
      urlFilter:`|https://leetcode.com${endpoint}|`,
      initiatorDomains:[extensionId],requestMethods:['post'],resourceTypes:['xmlhttprequest']
    }
  };
}

// One short-lived rule at a time, limited to our worker's exact judge URL.
// Requests from normal tabs and other extensions never match this initiator.
export class JudgeHeaders{
  constructor({netRequest,extensionId}){
    this.netRequest=netRequest;this.extensionId=extensionId;this.queue=Promise.resolve();
    this.cleanupFailed=false;
  }
  run(endpoint,method,send){
    if(method!=='POST'||!/^\/problems\/[a-z0-9-]+\/(interpret_solution|submit)\/$/.test(endpoint))return send();
    const execute=async()=>{
      const rule=judgeHeaderRule(endpoint,this.extensionId);
      // Replacing the fixed ID also clears a rule left by worker termination.
      await this.netRequest.updateSessionRules({removeRuleIds:[ruleId],addRules:[rule]});
      try{return await send();}
      finally{
        // A cleanup failure must never hide an already received remote judge ID.
        try{await this.netRequest.updateSessionRules({removeRuleIds:[ruleId]});this.cleanupFailed=false;}
        catch{this.cleanupFailed=true;}
      }
    };
    const result=this.queue.then(execute,execute);
    this.queue=result.catch(()=>{});
    return result;
  }
}
