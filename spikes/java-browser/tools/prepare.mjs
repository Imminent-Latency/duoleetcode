import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access,cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {patchJavacs} from './patch-javacs.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const vendor=path.join(root,'vendor');
const pub=path.join(root,'public');
const jdtVersion='jdt-language-server-1.64.0-202610301801.tar.gz';
const jdtSha='3bff77299e7449ddec5466e1c600a5f221312b057240b06162b7d9326bb9ca5e';
const javacsRevision='58daaa29a0e2fe22764283607da6801cf8b493b9';
async function exists(p) {try {await access(p);return true;} catch{return false;}}
function run(command,args,cwd=root,env=process.env) {
  const result=spawnSync(command,args,{cwd,env,stdio:'inherit'});
  if(result.error || result.status!==0) throw result.error || new Error(command+' exited '+result.status);
}
async function download(url,dest,sha) {
  if(!await exists(dest)) {
    console.log('Downloading '+url);
    const response=await fetch(url);
    if(!response.ok) throw new Error(response.status+' '+url);
    await writeFile(dest,new Uint8Array(await response.arrayBuffer()));
  }
  if(sha && createHash('sha256').update(await readFile(dest)).digest('hex')!==sha) throw new Error('Checksum mismatch: '+dest);
}
await mkdir(vendor,{recursive:true}); await mkdir(pub,{recursive:true});
for(const dir of ['bridge','manifest','jar-launcher']) await mkdir(path.join(root,'build',dir),{recursive:true});
const candidates=[process.env.JAVA_HOME,path.join(os.homedir(),'.sdkman/candidates/java/25.0.4.1+1-tem')].filter(Boolean);
let jdk;
for(const candidate of candidates) {
  const result=spawnSync(path.join(candidate,'bin/java'),['-version'],{encoding:'utf8'});
  if(result.status===0 && /version "25[.\"]/.test(result.stderr)) {jdk=candidate;break;}
}
if(!jdk) throw new Error('Set JAVA_HOME to a JDK 25 installation for artifact preparation. Browser execution does not use this JDK.');
await download('https://download.eclipse.org/jdtls/snapshots/'+jdtVersion,path.join(vendor,'jdtls-1.64.0.tar.gz'),jdtSha);
run('tar',['-xzf',path.join(vendor,'jdtls-1.64.0.tar.gz'),'-C',pub]);
run(path.join(jdk,'bin/jar'),['cf',path.join(pub,'jdtls-runtime.zip'),'-C',pub,'plugins','-C',pub,'config_linux']);
run(path.join(jdk,'bin/javac'),['--release','8','-d',path.join(root,'build/bridge'),path.join(root,'java/BrowserJdtBridge.java')]);
run(path.join(jdk,'bin/jar'),['cf',path.join(pub,'browser-jdt-bridge.jar'),'-C',path.join(root,'build/bridge'),'.']);
for(const [name,dir,manifest,jar] of [['ModuleOpensProbe','manifest','module-opens.mf','module-opens-probe.jar'],['BrowserJarLauncher','jar-launcher','browser-javacs.mf','browser-javacs.jar']]) {
  run(path.join(jdk,'bin/javac'),['--release','17','-d',path.join(root,'build',dir),path.join(root,'java',name+'.java')]);
  run(path.join(jdk,'bin/jar'),['cfm',path.join(pub,jar),path.join(root,'java',manifest),'-C',path.join(root,'build',dir),'.']);
}
await download('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.tar.gz',path.join(vendor,'maven.tar.gz'));
run('tar',['-xzf',path.join(vendor,'maven.tar.gz'),'-C',vendor]);
const source=path.join(vendor,'javacs');
if(!await exists(source)) run('git',['clone','https://github.com/georgewfraser/java-language-server.git',source]);
const current=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'});
if(current.stdout.trim()!==javacsRevision) run('git',['checkout','--detach',javacsRevision],source);
await patchJavacs(source);
run(path.join(vendor,'apache-maven-3.9.11/bin/mvn'),['-B','-q','package','-DskipTests'],source,{...process.env,JAVA_HOME:jdk});
for(const file of ['java-language-server.jar','gson-2.8.9.jar','protobuf-java-3.25.5.jar']) await cp(path.join(source,'dist/classpath',file),path.join(pub,file));
console.log('Prepared pinned JDT LS and javacs browser experiments.');
