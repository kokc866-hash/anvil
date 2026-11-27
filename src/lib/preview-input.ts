import type { InputMap } from './input-map.ts';

export type PreviewPoint = { x: number; y: number };
export type PreviewTarget = { selector?: string; x?: number; y?: number };
export type PlayAction = PreviewTarget & {
  type: 'key' | 'click' | 'move' | 'drag' | 'scroll' | 'type' | 'wait' | 'assert';
  key?: string; modifiers?: string[]; hold_ms?: number;
  button?: 'left' | 'middle' | 'right'; count?: number;
  to_selector?: string; to_x?: number; to_y?: number; duration_ms?: number;
  delta_x?: number; delta_y?: number; text?: string; ms?: number;
  value?: string; checked?: boolean; visible?: boolean; timeout_ms?: number;
};
export type PlayInput = { keys: string[]; hold: number; actions: PlayAction[] };

export function previewCheckNote(ok: boolean, assertions: number): string {
  if(!ok)return 'Eingabefolge oder Ergebnisprüfung fehlgeschlagen. Beachte error und den tatsächlich beobachteten Zustand; bereits ausgeführte Eingaben nicht blind wiederholen.';
  if(assertions>0)return 'Nur die angegebenen assert-Erwartungen wurden bestätigt. Weitere Funktionen bleiben ungeprüft.';
  return 'Eingaben zugestellt. Es wurde keine Ergebniserwartung geprüft. Leite das erwartete Ergebnis aus dem Auftrag ab und prüfe es mit play/actions/type:"assert". Echte Selektoren und Ist-Werte stehen unter observations und elements; aktuelle Werte allein sind keine Soll-Erwartung.';
}
export type PreviewKey = { key: string; code: string; keyCode: string; modifiers: string[] };
export type PreviewEvent = { type: 'keyDown' | 'keyUp'; key: PreviewKey }
  | { type: 'mouseMove' | 'mouseDown' | 'mouseUp'; point: PreviewPoint; button: string; count: number }
  | { type: 'scroll'; point: PreviewPoint; delta_x: number; delta_y: number }
  | { type: 'type'; text: string; selector?: string };
export type PreviewDriver = {
  current: () => void;
  target: (target: PreviewTarget, scroll?: boolean) => Promise<PreviewPoint>;
  event: (event: PreviewEvent, release?: boolean) => Promise<void>;
  assert: (action: PlayAction) => Promise<void>;
};

/** Validate the entire sequence before its first effect. No silent truncation. */
export function parsePlayInput(raw: { keys?: unknown; hold_ms?: unknown; hold?: unknown; actions?: unknown }): PlayInput {
  const keys = raw.keys === undefined ? [] : Array.isArray(raw.keys) ? raw.keys
    : typeof raw.keys === 'string' ? raw.keys === ' ' ? [' '] : raw.keys.split(/[,\s]+/).filter(Boolean) : null;
  if (!keys || !keys.every(k => typeof k === 'string' && k.length > 0 && k.length <= 64)) throw new Error('Ungültige Tastenfolge.');
  const number = (value: unknown, fallback: number, min = 0, max = 1000) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Eingabewert muss zwischen ${min} und ${max} liegen.`);
    return n;
  };
  const hold = number(raw.hold_ms ?? raw.hold, 90);
  if (raw.actions !== undefined && !Array.isArray(raw.actions)) throw new Error('actions muss eine Liste sein.');
  const list = (raw.actions ?? []) as unknown[];
  if (!keys.length && !list.length || keys.length + list.length > 32) throw new Error('play benötigt 1 bis 32 Eingabeaktionen.');
  const target = (a: Record<string, unknown>, prefix = '') => {
    const selector = a[prefix + 'selector'], x = a[prefix + 'x'], y = a[prefix + 'y'];
    if (selector !== undefined && (typeof selector !== 'string' || !selector.trim() || selector.length > 512)) throw new Error('Ungültiger CSS-Selektor.');
    if (x !== undefined || y !== undefined) {
      number(x, NaN, 0, 16384); number(y, NaN, 0, 16384);
      if (selector !== undefined) throw new Error('Entweder Selektor oder Vorschaukoordinaten angeben.');
    }
    if (selector === undefined && x === undefined) throw new Error('Eingabe benötigt einen Selektor oder x/y in der Vorschau.');
  };
  const actions = list.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Eingabeaktion.');
    const a = value as Record<string, unknown>;
    const allowed: Record<string, string[]> = {
      key: ['key','modifiers','hold_ms','selector'], click: ['selector','x','y','button','count'],
      move: ['selector','x','y'], drag: ['selector','x','y','to_selector','to_x','to_y','button','duration_ms'],
      scroll: ['selector','x','y','delta_x','delta_y'], type: ['selector','text'], wait: ['ms'],
      assert: ['selector','text','value','checked','visible','count','timeout_ms'],
    };
    if (typeof a.type !== 'string' || !Object.hasOwn(allowed, a.type) || Object.keys(a).some(k => k !== 'type' && !allowed[a.type as string].includes(k))) throw new Error('Unbekannte Aktion oder Eingabeoption.');
    if (['click','move','drag','scroll'].includes(a.type)) target(a);
    if (a.type === 'drag') { target(a, 'to_'); number(a.duration_ms, 250); }
    if (a.button !== undefined && !['left','middle','right'].includes(String(a.button))) throw new Error('Unbekannte Maustaste.');
    if (a.type === 'click' && a.count !== undefined && a.count !== 1 && a.count !== 2) throw new Error('Klickanzahl muss 1 oder 2 sein.');
    if (a.type === 'key') {
      if (typeof a.key !== 'string' || !a.key || a.key.length > 64) throw new Error('Eine Taste fehlt.');
      if (a.modifiers !== undefined && (!Array.isArray(a.modifiers) || a.modifiers.length > 4 || !a.modifiers.every(m => typeof m === 'string' && /^(?:Control|Ctrl|Shift|Alt|Meta)$/i.test(m)))) throw new Error('Unbekannte Zusatztaste.');
      number(a.hold_ms, hold);
    }
    if (a.selector !== undefined && (typeof a.selector !== 'string' || !a.selector.trim() || a.selector.length > 512)) throw new Error('Ungültiger CSS-Selektor.');
    if (a.type === 'scroll') { number(a.delta_x, 0, -4000, 4000); number(a.delta_y, 0, -4000, 4000); }
    if (a.type === 'type' && (typeof a.text !== 'string' || !a.text || a.text.length > 4000)) throw new Error('Texteingabe benötigt 1 bis 4000 Zeichen.');
    if (a.type === 'wait') number(a.ms, 100);
    if (a.type === 'assert') {
      if (typeof a.selector !== 'string' || !['text','value','checked','visible','count'].some(k=>a[k]!==undefined)) throw new Error('assert benötigt einen Selektor und eine erwartete Eigenschaft.');
      if (a.text!==undefined && (typeof a.text!=='string' || a.text.length>4000) || a.value!==undefined && (typeof a.value!=='string' || a.value.length>4000)) throw new Error('Ungültiger erwarteter Text.');
      for (const key of ['visible','checked']) if(a[key]!==undefined && typeof a[key]!=='boolean')throw new Error('Erwarteter Zustand muss true oder false sein.');
      if(a.count!==undefined && (!Number.isInteger(a.count) || Number(a.count)<0 || Number(a.count)>1000))throw new Error('Ungültige erwartete Elementanzahl.');
      number(a.timeout_ms, 0, 0, 3000);
    }
    return { ...a } as PlayAction;
  });
  const duration = keys.length * hold + actions.reduce((n, a) => n + (a.type === 'key' ? a.hold_ms ?? hold : a.type === 'drag' ? a.duration_ms ?? 250 : a.type === 'wait' ? a.ms ?? 100 : 0), 0);
  if (duration > 10000) throw new Error('Eine Eingabefolge darf höchstens 10 Sekunden dauern. Teile längere Tests auf.');
  return { keys: keys as string[], hold, actions };
}

export function resolvePreviewKey(raw: string, map?: InputMap, modifiers: string[] = []): PreviewKey {
  const action = raw.toLowerCase();
  const mapped = ['left','right','up','down','ok','fire','start'].includes(action)
    ? map?.[action as keyof InputMap] as { keys?: string[] } : undefined;
  let key = mapped?.keys?.[0] ?? raw;
  const aliases: Record<string, string> = { left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown',ok:'Enter',space:' ',spacebar:' ',esc:'Escape',escape:'Escape',enter:'Enter',return:'Enter',tab:'Tab',delete:'Delete',del:'Delete',backspace:'Backspace',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown',insert:'Insert',arrowleft:'ArrowLeft',arrowright:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',shift:'Shift',ctrl:'Control',control:'Control',alt:'Alt',meta:'Meta' };
  const physical = key;
  key = aliases[key.toLowerCase()] ?? (/^Key[A-Z]$/.test(key) ? key.slice(3).toLowerCase() : /^Digit[0-9]$/.test(key) ? key.slice(5) : /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(key) ? key.replace(/Left|Right/,'') : key);
  if (!/^(?:[\x20-\x7e]|Arrow(?:Left|Right|Up|Down)|Enter|Escape|Tab|Delete|Backspace|Home|End|PageUp|PageDown|Insert|Shift|Control|Alt|Meta|F(?:[1-9]|1[0-2]))$/.test(key)) throw new Error('Diese Taste wird in der Vorschau nicht unterstützt: ' + raw);
  const mods = [...new Set(modifiers.map(m => /^ctrl|control$/i.test(m) ? 'Control' : m[0].toUpperCase() + m.slice(1).toLowerCase()))];
  if (mods.some(m => !['Control','Shift','Alt','Meta'].includes(m))) throw new Error('Unbekannte Zusatztaste.');
  if (/^[A-Z]$/.test(key) && !mods.includes('Shift')) mods.push('Shift');
  if (mods.includes('Shift') && /^[a-z]$/.test(key)) key=key.toUpperCase();
  // Use explicit type text instead of reading the desktop clipboard.
  if ((mods.includes('Control') || mods.includes('Meta')) && /^[cvx]$/i.test(key) || mods.includes('Shift') && ['Insert','Delete'].includes(key)) throw new Error('Zwischenablagekürzel sind in play nicht verfügbar. Für Text die Aktion type verwenden.');
  const code = /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(physical) ? physical : key === ' ' ? 'Space' : /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^\d$/.test(key) ? 'Digit' + key : key;
  const keyCode = key === ' ' ? 'Space' : key.startsWith('Arrow') ? key.slice(5) : key;
  return { key, code, keyCode, modifiers: mods };
}

/** Shared ordering, abort and release rules for native and iframe previews. */
export async function performPreviewInput(input: PlayInput, map: InputMap | undefined, driver: PreviewDriver, signal?: AbortSignal) {
  const sequence: PlayAction[] = [...input.keys.map(key => ({ type:'key' as const, key, hold_ms:input.hold })), ...input.actions];
  let completed = 0, assertions = 0;
  let validating = true;
  let dispatched = false;
  const event: PreviewDriver['event'] = (input, release) => {
    if (!release) dispatched = true;
    return driver.event(input, release);
  };
  const current = () => { signal?.throwIfAborted(); driver.current(); };
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason || new Error('Eingabe abgebrochen.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once:true });
  });
  try {
    current();
    // Reject every invalid key before sending any earlier action, retaining
    // the same pre-execution classification as a rejected target.
    for (const a of sequence) if (a.type === 'key') resolvePreviewKey(a.key!, map, a.modifiers);
    validating = false;
    for (const a of sequence) {
      current();
      if (a.type === 'key') {
        if (a.selector) await event({ type:'type', text:'', selector:a.selector }); // focus without changing content
        const key = resolvePreviewKey(a.key!, map, a.modifiers);
        try { await event({ type:'keyDown', key }); current(); await wait(a.hold_ms ?? input.hold); }
        finally { await event({ type:'keyUp', key }, true); }
      } else if (a.type === 'type') await event({ type:'type', text:a.text!, selector:a.selector });
      else if (a.type === 'wait') await wait(a.ms ?? 100);
      else if (a.type === 'assert') {
        const until=Date.now()+(a.timeout_ms??0);
        for(;;) { current(); try { await driver.assert(a); assertions++; break; } catch(error) { current(); if(Date.now()>=until)throw error; await wait(Math.min(50,until-Date.now())); } }
      }
      else {
        const point = await driver.target(a); current();
        const button = a.button ?? 'left', count = a.count ?? 1;
        if (a.type === 'scroll') {
          // Chromium wheels target the current pointer, not only their x/y fields.
          await event({type:'mouseMove',point,button:'left',count:0}); current();
          await event({ type:'scroll', point, delta_x:a.delta_x ?? 0, delta_y:a.delta_y ?? 0 });
        }
        else {
          await event({ type:'mouseMove', point, button, count }); current();
          if (a.type === 'click' || a.type === 'drag') {
            // Do not scroll the destination and invalidate the captured start point.
            // Both ends must be reachable in the same preview viewport.
            const end = a.type === 'drag' ? await driver.target({selector:a.to_selector,x:a.to_x,y:a.to_y},false) : point;
            current(); let last = point;
            for (let click = 1; click <= count; click++) {
              try {
                await event({ type:'mouseDown', point, button, count:click }); current();
                if (a.type === 'drag') for (let step = 1; step <= 10; step++) {
                  await wait((a.duration_ms ?? 250) / 10); current();
                  last = { x:point.x+(end.x-point.x)*step/10, y:point.y+(end.y-point.y)*step/10 };
                  await event({ type:'mouseMove', point:last, button, count:1 }); current();
                }
              } finally { await event({ type:'mouseUp', point:last, button, count:click }, true); }
            }
          }
        }
      }
      current(); completed++;
      await wait(25); current();
    }
    return { completed, total:sequence.length, assertions };
  } catch (error) {
    if (error && typeof error === 'object') {
      const inputRejected = !dispatched && completed === 0 && (validating || sequence[completed]?.type !== 'assert') && !signal?.aborted;
      const first = sequence[0];
      // Only a real single click on an absent selector is a usable negative
      // test. Bad CSS, covered controls and partial input have other outcomes.
      const missing = inputRejected && sequence.length === 1 && first?.type === 'click' && (first.count ?? 1) === 1
        && first.selector && error instanceof Error
        && error.message === `Selektor muss genau ein Element treffen (0 gefunden): ${first.selector}`;
      Object.assign(error, { inputProgress: { completed, total: sequence.length, assertions }, inputRejected,
        ...(missing ? { previewMissingTarget: first.selector } : {}) });
    }
    throw error;
  }
}
