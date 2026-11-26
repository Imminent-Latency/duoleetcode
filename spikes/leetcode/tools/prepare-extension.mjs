import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),dest=new URL('extension/manifest.json',root);
let key;
try{key=JSON.parse(await readFile(dest,'utf8')).key;}catch(error){if(error.code!=='ENOENT')throw error;}
// Only the public key is retained, to keep the unpacked extension ID stable.
key??=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');
const id=[...createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32)].map(n=>String.fromCharCode(97+parseInt(n,16))).join('');
const manifest={manifest_version:3,name:'DuoLeetCode Local Bridge',version:'0.1.7',description:'Use your existing LeetCode session from DuoLeetCode without opening LeetCode tabs or exporting login cookies.',minimum_chrome_version:'120',incognito:'not_allowed',key,permissions:['cookies','storage','declarativeNetRequestWithHostAccess'],host_permissions:['https://leetcode.com/*'],background:{service_worker:'background.mjs',type:'module'},externally_connectable:{matches:['http://127.0.0.1/*','http://localhost/*']},content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; connect-src https://leetcode.com"}};
await writeFile(dest,JSON.stringify(manifest,null,2)+'\n');
await copyFile(new URL('client.mjs',root),new URL('extension/client.mjs',root));
await writeFile(new URL('public/extension-config.js',root),`// Public extension ID; not a credential.\nexport const extensionId='${id}';\n`);
console.log(`Unpacked extension: ${new URL('extension/',root).pathname}\nExtension ID: ${id}`);
