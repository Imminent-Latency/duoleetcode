/* Minimal, byte-framed LSP transport for this experiment. No language logic lives here. */
globalThis.BrowserLanguageClient = class {
  constructor(bridge, emit) {
    this.bridge=bridge; this.emit=emit; this.pending=new Map(); this.nextId=1;
    this.buffer=new Uint8Array(); this.encoder=new TextEncoder(); this.decoder=new TextDecoder();
    this.active=true; this.status=''; this.poll();
  }
  async send(message) {
    const body=JSON.stringify(message);
    await this.bridge.send(`Content-Length: ${this.encoder.encode(body).length}\r\n\r\n${body}`);
  }
  request(method,params,timeout=60000) {
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(method+' timed out after '+timeout+'ms'));},timeout);
      this.pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      this.send({jsonrpc:'2.0',id,method,params}).catch(error=>{clearTimeout(timer);this.pending.delete(id);reject(error);});
    });
  }
  notify(method,params) {return this.send({jsonrpc:'2.0',method,params});}
  async consume(bytes) {
    const joined=new Uint8Array(this.buffer.length+bytes.length);
    joined.set(this.buffer); joined.set(bytes,this.buffer.length); this.buffer=joined;
    while(this.buffer.length) {
      const decoded=this.decoder.decode(this.buffer);
      const start=decoded.indexOf('Content-Length: ');
      if(start<0) return;
      if(start>0) {
        const log=decoded.slice(0,start); this.emit('engine-log',{message:log});
        this.buffer=this.buffer.slice(this.encoder.encode(log).length);
      }
      const header=this.decoder.decode(this.buffer).match(/^Content-Length: (\d+)\r\n(?:[^\r]+\r\n)*\r\n/);
      if(!header) return;
      const offset=this.encoder.encode(header[0]).length, length=Number(header[1]);
      if(this.buffer.length<offset+length) return;
      const message=JSON.parse(this.decoder.decode(this.buffer.slice(offset,offset+length)));
      this.buffer=this.buffer.slice(offset+length);
      if(message.method && message.id!=null) {
        const result=message.method==='workspace/configuration' ? (message.params?.items||[]).map(()=>({})) : null;
        await this.send({jsonrpc:'2.0',id:message.id,result});
      } else if(message.id!=null) {
        const pending=this.pending.get(message.id); this.pending.delete(message.id);
        if(pending) message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      } else this.emit('notification',{method:message.method,params:message.params});
    }
  }
  async poll() {
    try {
      while(this.active) {
        const status=await this.bridge.status();
        if(status!==this.status) {this.emit('engine-status',{message:status});this.status=status;}
        const output=await this.bridge.drainOutputBase64();
        if(output) await this.consume(Uint8Array.from(atob(output),ch=>ch.charCodeAt(0)));
        const errors=await this.bridge.drainErrors();
        if(errors) this.emit('stderr',{message:errors});
        if(status.startsWith('failed:') || status.includes('returned')) throw new Error(status);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
    } catch(error) {
      this.emit('transport-error',{message:String(error)});
      for(const item of this.pending.values()) item.reject(error);
      this.pending.clear();
    }
  }
  close() {this.active=false;}
};
