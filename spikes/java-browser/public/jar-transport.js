globalThis.createJarTransport=(emit)=>{
  const input=[]; let waiting;
  let output='',errors='',state='starting executable JAR';
  const bridge={
    async send(message) {if(waiting) {const resolve=waiting;waiting=null;resolve(message);} else input.push(message);},
    async status() {return state;},
    async drainOutputBase64() {
      const bytes=new TextEncoder().encode(output); output='';
      let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
      return btoa(binary);
    },
    async drainErrors() {const value=errors;errors='';return value;}
  };
  const natives={
    async Java_BrowserJarLauncher_readInput() {return input.length?input.shift():new Promise(resolve=>waiting=resolve);},
    async Java_BrowserJarLauncher_writeOutput(lib,value) {output+=value;},
    async Java_BrowserJarLauncher_writeError(lib,value) {errors+=value;},
    async Java_BrowserJarLauncher_ready(lib,version,moduleOpen) {state='running javacs';emit('java-ready',{version,moduleOpen});}
  };
  return {bridge,natives,exited(code){state='Java application returned '+code;}};
};
