/** Run JS in a unique-origin iframe so it cannot read Anvil sessionStorage. */

export function runJsSandboxed(code: string, ms = 8000): Promise<{ stdout: string; stderr: string }> {
  if (typeof document === "undefined") {
    return Promise.resolve({ stdout: "", stderr: "Kein Browser" });
  }
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;left:-99px;top:-99px;width:8px;height:8px;opacity:0;border:0;pointer-events:none";
    const payload = JSON.stringify(code);
    const done = (stdout: string, stderr: string) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      iframe.remove();
      resolve({ stdout, stderr });
    };
    const timer = window.setTimeout(() => done("", "Zeitüberschreitung"), ms);
    function onMsg(ev: MessageEvent) {
      if (ev.source !== iframe.contentWindow) return;
      const d = ev.data as { anvilRun?: number; logs?: string[]; err?: string; result?: string };
      if (d?.anvilRun !== 1) return;
      const logs = Array.isArray(d.logs) ? d.logs.map(String) : [];
      let stdout = logs.join("\n");
      if (d.result) stdout = stdout ? `${stdout}\n${d.result}` : d.result;
      done(stdout, d.err ? String(d.err) : "");
    }
    window.addEventListener("message", onMsg);
    document.body.appendChild(iframe);
    iframe.srcdoc = `<!doctype html><script>
(function(){
  var logs=[];
  function fmt(a){try{return typeof a==="string"?a:JSON.stringify(a)}catch(e){return String(a)}}
  var c={log:function(){logs.push([].map.call(arguments,fmt).join(" "))},
    error:function(){logs.push([].map.call(arguments,fmt).join(" "))},
    warn:function(){logs.push([].map.call(arguments,fmt).join(" "))},
    info:function(){logs.push([].map.call(arguments,fmt).join(" "))}};
  window.console=c;
  window.onerror=function(m){parent.postMessage({anvilRun:1,err:String(m),logs:logs},"*")};
  try{
    var r=(0,eval)(${payload});
    Promise.resolve(r).then(function(v){
      parent.postMessage({anvilRun:1,logs:logs,result:v===undefined?"":fmt(v)},"*");
    }, function(e){
      parent.postMessage({anvilRun:1,err:String(e&&e.stack||e),logs:logs},"*");
    });
  }catch(e){
    parent.postMessage({anvilRun:1,err:String(e&&e.stack||e),logs:logs},"*");
  }
})();
<\/script>`;
  });
}
