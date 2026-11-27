/** Artificial application for real preview input tests. No model/network/data access. */
export const previewInputFiles = {'index.html':`<!doctype html><html><head><meta charset="utf-8"><title>Vorschau-Eingaben</title><style>
body{margin:24px;background:#17212b;color:#f4f7fa;font:18px system-ui}main{max-width:840px}button,input,textarea{font:inherit;margin:6px;padding:8px}button{cursor:pointer}canvas{display:block;background:#254159;margin:12px 0}#scroll{height:90px;width:380px;overflow:auto;background:#28483c}#long{height:900px;padding:8px}#hidden{display:none}#drag-result{min-height:26px}output{display:block;margin:8px 0;color:#b8f5cf}#hover:hover{background:#82edbb}</style></head><body><main>
<h1>Vorschau-Eingaben</h1><p>Künstliches Testprojekt für Tastatur, Maus und überprüfbare Zustände.</p>
<button id="start">Start/Pause</button><button id="add">Hinzufügen</button><button id="hover">Maus darüber</button>
<output id="status">Paused</output><output id="count">0</output><output id="shortcuts">none</output>
<label>Name <input id="name" value="Seed"></label><label><input id="agree" type="checkbox">Auswahl</label><textarea id="note">Notiz</textarea>
<button id="item">Löschbares Element</button><button id="disabled" disabled>Gesperrt</button><button id="hidden">Unsichtbar</button><input id="file" type="file"><label id="file-label" for="file">Datei auswählen</label>
<canvas id="drag" width="400" height="100" tabindex="0"></canvas><output id="drag-result">No drag</output>
<div id="scroll"><div id="long">Scrollbereich<br>Weitere Inhalte weiter unten.</div></div><output id="scroll-result">0</output>
<div style="position:relative;width:240px;height:45px"><button id="covered" style="position:absolute;inset:0">Verdecktes Ziel</button><div style="position:absolute;inset:0;background:#304056">Abdeckendes Element</div></div>
<script>
window.fixture={keys:[],held:[],moves:0,downs:0,ups:0,right:0,double:0,hover:0,inputs:0,changes:0,ctrl:0};
const f=window.fixture;let n=0,running=false;const status=document.getElementById('status');
function toggle(){running=!running;status.textContent=running?'Running':'Paused'}
document.getElementById('start').onclick=toggle;document.getElementById('add').onclick=()=>document.getElementById('count').textContent=String(++n);
document.getElementById('add').ondblclick=()=>f.double++;
document.getElementById('hover').onmouseover=()=>f.hover++;
document.addEventListener('keydown',e=>{f.keys.push({key:e.key,code:e.code,ctrl:e.ctrlKey,shift:e.shiftKey});f.held.push(e.key);if(e.ctrlKey&&e.key==='z'){e.preventDefault();f.ctrl++;}
if(/INPUT|TEXTAREA/.test(e.target.tagName))return;
if(e.key===' '){e.preventDefault();toggle()}if(['s','u','r','Delete'].includes(e.key)){document.getElementById('shortcuts').textContent=e.key;if(e.key==='Delete')document.getElementById('item')?.remove();}});
document.addEventListener('keyup',e=>{f.held=f.held.filter(k=>k!==e.key)});
document.getElementById('name').oninput=()=>f.inputs++;document.getElementById('name').onchange=()=>f.changes++;
const c=document.getElementById('drag');window.fixtureControls=Anvil.attach(c);const ctx=c.getContext('2d');ctx.fillStyle='#80e5bb';ctx.fillRect(20,20,90,60);ctx.fillStyle='#ffffff';ctx.font='18px system-ui';ctx.fillText('Ziehen und loslassen',140,56);
c.addEventListener('pointerdown',e=>{f.downs++;f.lastButtons=e.buttons;f.dragging=true;try{c.setPointerCapture(e.pointerId)}catch{}});
c.addEventListener('pointermove',e=>{if(f.dragging){f.moves++;f.lastX=e.clientX;}});
c.addEventListener('pointerup',()=>{f.ups++;f.dragging=false;document.getElementById('drag-result').textContent='Released'});
c.addEventListener('contextmenu',e=>{e.preventDefault();f.right++});
document.getElementById('scroll').onscroll=e=>document.getElementById('scroll-result').textContent=String(Math.round(e.target.scrollTop));
</script></main></body></html>`};
