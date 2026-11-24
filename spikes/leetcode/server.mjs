import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {LeetCodeClient} from './client.mjs';

const port=Number(process.env.LEETCODE_SPIKE_PORT||4318);
// Public reads only. No browser profile, cookies, credentials, or authenticated
// request forwarding exists on the server. The extension owns authenticated I/O.
const client=new LeetCodeClient({async request(endpoint,{method='GET',body}={}){
  if(endpoint!=='/graphql/')throw new Error('Only public GraphQL reads are supported');
  const response=await fetch('https://leetcode.com/graphql/',{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.headers.get('content-type')?.includes('json'))throw new Error('Public problem retrieval is unavailable. Connect the browser extension.');
  return response.json();
}});
const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
const staticFiles=new Set(['/','/app.js','/style.css','/extension-config.js']);
const server=http.createServer(async(req,res)=>{
  try{
    if(!hosts.has(req.headers.host))return json(res,403,{error:'Invalid host'});
    if(req.method!=='GET')return json(res,405,{error:'This server does not accept authenticated requests or credentials. Use the browser extension.'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(url.pathname.startsWith('/api/')&&req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Cross-site requests are not supported'});
    if(url.pathname==='/api/config')return json(res,200,{mode:'extension'});
    if(url.pathname==='/api/problems'){
      const skip=Number(url.searchParams.get('skip')||0),limit=Number(url.searchParams.get('limit')||10),search=url.searchParams.get('search')||'',difficulty=url.searchParams.get('difficulty')||'';
      if(!Number.isInteger(skip)||skip<0||!Number.isInteger(limit)||limit<1||limit>50||search.length>100||!['','EASY','MEDIUM','HARD'].includes(difficulty))return json(res,400,{error:'Invalid search filters'});
      return json(res,200,await client.list({skip,limit,search,difficulty}));
    }
    const problem=url.pathname.match(/^\/api\/problems\/([a-z0-9-]+)$/);
    if(problem)return json(res,200,await client.problem(problem[1]));
    if(url.pathname==='/api/fixture')return json(res,200,{slug:'two-sum',code:await readFile(new URL('./fixtures/TwoSum.java',import.meta.url),'utf8')});
    if(staticFiles.has(url.pathname)){
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1),data=await readFile(new URL('./public/'+file,import.meta.url));
      res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','cache-control':'no-cache','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'x-content-type-options':'nosniff'});return res.end(data);
    }
    return json(res,404,{error:'Not found'});
  }catch(error){json(res,error.status||502,{error:error.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`LeetCode extension spike: http://127.0.0.1:${port}`));
process.on('SIGTERM',()=>server.close());
process.on('SIGINT',()=>server.close());
