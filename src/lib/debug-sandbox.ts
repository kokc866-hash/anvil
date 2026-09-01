/** JS-Debugger im unique-origin iframe — kein Zugriff auf Anvil-sessionStorage. */

export type DbgCmd = "continue" | "step" | "stop";

type PauseInfo = {
  path: string;
  line: number;
  reason: string;
  locals: Record<string, unknown>;
};

export type JsDebugSession = {
  eval: (expr: string) => Promise<string>;
  watches: (exprs: string[]) => Promise<Record<string, string>>;
  kill: () => void;
  done: Promise<{ stdout: string; stderr: string }>;
};

export function startJsDebugIframe(
  instrumented: string,
  opts: {
    onPause: (info: PauseInfo) => Promise<DbgCmd>;
    shouldPause: (file: string, line: number, reason: string) => boolean;
    onLog?: (line: string) => void;
  },
): JsDebugSession {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:-120px;top:-120px;width:8px;height:8px;opacity:0;border:0;pointer-events:none";
  document.body.appendChild(iframe);

  let seq = 1;
  let killed = false;
  const evalWait = new Map<number, (s: string) => void>();
  let finish: (stdout: string, stderr: string) => void = () => undefined;

  const kill = () => {
    if (killed) return;
    killed = true;
    window.removeEventListener("message", onMsg);
    iframe.remove();
  };

  const send = (msg: Record<string, unknown>) => {
    try {
      iframe.contentWindow?.postMessage({ anvilDbg: 1, ...msg }, "*");
    } catch {
      /* gone */
    }
  };

  const done = new Promise<{ stdout: string; stderr: string }>((resolve) => {
    finish = (stdout, stderr) => {
      kill();
      resolve({ stdout, stderr });
    };
  });

  function onMsg(ev: MessageEvent) {
    if (ev.source !== iframe.contentWindow) return;
    const d = ev.data as Record<string, unknown>;
    if (d?.anvilDbg !== 1) return;
    const t = String(d.t ?? "");
    if (t === "log" && typeof d.lineText === "string") opts.onLog?.(d.lineText);
    if (t === "evalOut" && typeof d.id === "number") {
      evalWait.get(d.id)?.(String(d.value ?? ""));
      evalWait.delete(d.id);
    }
    if (t === "pause") {
      const file = String(d.file ?? "");
      const line = Number(d.line ?? 0);
      const reason = String(d.reason ?? "line");
      const locals = d.locals && typeof d.locals === "object" ? (d.locals as Record<string, unknown>) : {};
      const id = Number(d.id ?? 0);
      void (async () => {
        if (killed) return;
        if (!opts.shouldPause(file, line, reason) && reason !== "exception") {
          send({ t: "resume", id, cmd: "continue" });
          return;
        }
        const cmd = await opts.onPause({ path: file, line, reason, locals });
        send({ t: "resume", id, cmd });
      })();
    }
    if (t === "done") {
      const logs = Array.isArray(d.logs) ? (d.logs as unknown[]).map(String).join("\n") : "";
      finish(logs, d.err ? String(d.err) : "");
    }
  }

  window.addEventListener("message", onMsg);
  iframe.srcdoc = bootScript(instrumented);

  function ask(expr: string): Promise<string> {
    return new Promise((resolve) => {
      const id = seq++;
      evalWait.set(id, resolve);
      send({ t: "eval", id, expr: String(expr ?? "").slice(0, 400) });
      window.setTimeout(() => {
        if (evalWait.has(id)) {
          evalWait.delete(id);
          resolve("timeout");
        }
      }, 4000);
    });
  }

  return {
    eval: ask,
    watches: async (exprs) => {
      const out: Record<string, string> = {};
      for (const e of exprs) out[e] = await ask(e);
      return out;
    },
    kill,
    done,
  };
}

function bootScript(instrumented: string): string {
  const src = JSON.stringify(instrumented);
  return `<!doctype html><script>
(function(){
  var logs=[], waits={}, last={}, seq=1;
  function fmt(v){try{if(typeof v==="string")return JSON.stringify(v);var s=JSON.stringify(v);return s==null?String(v):s.length>240?s.slice(0,240)+"...":s}catch(e){return String(v).slice(0,240)}}
  function ser(o){var r={};if(!o||typeof o!=="object")return r;for(var k in o){if(String(k).charAt(0)==="_")continue;try{var v=o[k];if(typeof v==="function")continue;JSON.stringify(v);r[k]=v}catch(e){try{r[k]=String(o[k]).slice(0,120)}catch(e2){}}}return r}
  function say(){var s=[].map.call(arguments,function(a){return typeof a==="string"?a:fmt(a)}).join(" ");logs.push(s);parent.postMessage({anvilDbg:1,t:"log",lineText:s},"*")}
  window.console={log:say,error:say,warn:say,info:say};
  window.onerror=function(m){parent.postMessage({anvilDbg:1,t:"done",err:String(m),logs:logs},"*")};
  window.addEventListener("message",function(e){
    var d=e.data;if(!d||d.anvilDbg!==1)return;
    if(d.t==="resume"&&waits[d.id]){var fn=waits[d.id];delete waits[d.id];fn(d.cmd||"continue")}
    if(d.t==="eval"){
      var out="";
      try{
        var keys=Object.keys(last);
        var fn=Function.apply(null, keys.concat(['"use strict"; return (' + String(d.expr) + ');']));
        out=fmt(fn.apply(null, keys.map(function(k){return last[k]})));
      }catch(err){out=String(err&&err.message||err)}
      parent.postMessage({anvilDbg:1,t:"evalOut",id:d.id,value:out},"*");
    }
  });
  window.__dbg=function(line,file,locals,reason){
    last=locals||{};
    var id=seq++;
    parent.postMessage({anvilDbg:1,t:"pause",id:id,line:line,file:file,reason:reason||"line",locals:ser(last)},"*");
    return new Promise(function(res){waits[id]=res});
  };
  (async function(){
    try{
      var code=${src};
      var run=new Function("__dbg","return (async()=>{\\n"+code+"\\n})()");
      await run(window.__dbg);
      parent.postMessage({anvilDbg:1,t:"done",logs:logs},"*");
    }
    catch(e){ parent.postMessage({anvilDbg:1,t:"done",err:String(e&&e.stack||e),logs:logs},"*"); }
  })();
})();
<\/script>`;
}
