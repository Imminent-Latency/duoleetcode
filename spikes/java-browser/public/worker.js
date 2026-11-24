const started = performance.now();
const emit = (type, detail = {}) => postMessage({type, ms: Math.round(performance.now() - started), ...detail});
const settings = new URLSearchParams(location.search);
const version = Number(settings.get('java') || 25);
const mode = settings.get('mode') || 'javacs-jar';
const loader = 'https://cjrtnc.leaningtech.com/5.0/loader.js';
const launcher = '/app/plugins/org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar';
importScripts('/lsp-client.js', '/fixtures.js', '/jar-transport.js');
let client;

(async () => {
  emit('stage', {message:'Loading CheerpJ 5.0', version, mode});
  importScripts(loader);
  const jar=mode==='javacs-jar'?createJarTransport(emit):null;
  await cheerpjInit({version, status:'none',natives:jar?.natives,javaProperties: settings.has('opens') ? ['jdk.module.addopens.0=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED'] : []});
  emit('runtime-ready');
  if(mode==='manifest' || (mode==='javacs' && settings.get('launcher')==='manifest')) {
    const exitCode=await cheerpjRunJar('/app/module-opens-probe.jar');
    if(exitCode!==0) throw new Error('Manifest Add-Opens probe exited '+exitCode);
    emit('module-access-ready',{exitCode});
    if(mode==='manifest') {emit('done'); return;}
  }
  let bridge;
  if(jar) {
    bridge=jar.bridge;
    cheerpjRunJar('/app/browser-javacs.jar').then(code=>jar.exited(code)).catch(error=>emit('error',{message:String(error)}));
  } else {
  const enginePath = mode === 'javacs' ? '/app/java-language-server.jar:/app/gson-2.8.9.jar:/app/protobuf-java-3.25.5.jar' : launcher;
  const lib = await cheerpjRunLibrary('/app/browser-jdt-bridge.jar:' + enginePath);
  const rawBridge = await lib.BrowserJdtBridge;
  // CheerpJ library-mode calls must be awaited one at a time, including polling.
  let javaQueue=Promise.resolve();
  bridge=new Proxy({},{get(target,method){return (...args)=>{
    const call=javaQueue.then(()=>rawBridge[method](...args));
    javaQueue=call.catch(()=>{});
    return call;
  };}});
  emit('java-ready', {version:await bridge.version()});
  if (mode === 'smoke') { emit('done'); return; }
  if (mode === 'jdt') {
    emit('stage', {message:'Preparing Eclipse JDT LS filesystem'});
    const preparation = await bridge.prepare('/app/jdtls-runtime.zip');
    emit('filesystem-ready', {message:preparation});
    await bridge.start();
  } else {
    await bridge.writeFile('/files/project/Solution.java', 'class Solution {}');
    await bridge.startJavacs();
  }
  }
  emit('engine-started');
  client = new BrowserLanguageClient(bridge,emit);
  const initialized = await client.request('initialize', {
      processId:null, rootUri:'file:///files/project',
      workspaceFolders:[{uri:'file:///files/project',name:'interview'}],
      capabilities:{workspace:{configuration:true},textDocument:{completion:{completionItem:{snippetSupport:true}}}},
      initializationOptions:{settings:{java:{import:{maven:{enabled:false},gradle:{enabled:false}}}}}
  });
  if (!initialized?.capabilities?.completionProvider) throw new Error('Engine did not advertise completion support');
  emit('initialized',{capabilities:initialized.capabilities});
  await client.notify('initialized',{});
  let documentVersion=0;
  const warmCount=Math.min(30,Math.max(1,Number(settings.get('warm')||1)));
  const cases=[...completionFixtures,...Array.from({length:warmCount},(_,i)=>completionFixtures[i%completionFixtures.length])];
  for (const fixture of cases) {
    const prefix=fixture.source.split('/*cursor*/')[0];
    const text=fixture.source.replace('/*cursor*/','');
    const lines=prefix.split('\n');
    const uri='file:///files/project/Solution.java';
    if(!jar) await bridge.writeFile('/files/project/Solution.java',text);
    if(documentVersion===0) await client.notify('textDocument/didOpen',{textDocument:{uri,languageId:'java',version:++documentVersion,text}});
    else await client.notify('textDocument/didChange',{textDocument:{uri,version:++documentVersion},contentChanges:[{text}]});
    const begin=performance.now();
    const completion=await client.request('textDocument/completion',{textDocument:{uri},position:{line:lines.length-1,character:lines.at(-1).length},context:{triggerKind:1}});
    const items=Array.isArray(completion)?completion:completion?.items||[];
    const labels=items.map(item=>item.label);
    const passed=fixture.expected.every(expected=>labels.some(label=>label===expected||label.startsWith(expected+'(')));
    emit('completion',{name:fixture.name,repeat:documentVersion>completionFixtures.length,elapsedMs:Math.round(performance.now()-begin),passed,count:items.length,labels});
  }
  emit('done');
})().catch(error => emit('error', {message:String(error), stack:error?.stack})).finally(()=>client?.close());
