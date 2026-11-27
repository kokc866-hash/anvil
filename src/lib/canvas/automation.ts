import type { PlayAction, PreviewEvent, PreviewTarget } from '../preview-input.ts';
import type { CanvasInput } from './input.ts';

/** Serialized into the untrusted preview. Has no editor/native privileges. */
export function installPreviewAutomation(win: Window & typeof globalThis, inputs: CanvasInput) {
  const doc = win.document;
  let held: Element | null = null, hover: Element | null = null, buttons = 0;
  const edited = new Map<HTMLInputElement | HTMLTextAreaElement, string>();
  const editable = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
    el instanceof win.HTMLTextAreaElement || el instanceof win.HTMLInputElement && /^(text|search|email|url|tel|password|number)$/.test(el.type);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect(), s = win.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  function element(selector: string) {
    let matches: NodeListOf<Element>;
    try { matches = doc.querySelectorAll(selector); } catch { throw new Error('Ungültiger CSS-Selektor: ' + selector); }
    if (matches.length !== 1) throw new Error(`Selektor muss genau ein Element treffen (${matches.length} gefunden): ${selector}`);
    const el = matches[0];
    if (!visible(el) || el.matches(':disabled,[inert],input[type=file]') || el.closest('[inert]')) throw new Error('Ziel ist nicht bedienbar: ' + selector);
    return el;
  }
  function focus(el: Element) {
    for (const [field, before] of edited) if (field !== el) {
      if (field.value !== before) field.dispatchEvent(new win.Event('change', { bubbles:true }));
      edited.delete(field);
    }
    if (el instanceof win.HTMLElement) el.focus({preventScroll:true});
  }
  function target(value: PreviewTarget, scroll = true) {
    let x = value.x, y = value.y;
    if (value.selector) {
      const el = element(value.selector);
      const before=el.getBoundingClientRect();
      if (before.bottom<=0 || before.right<=0 || before.top>=win.innerHeight || before.left>=win.innerWidth) {
        if(!scroll)throw new Error('Das Ziehziel liegt außerhalb der aktuellen Vorschauansicht. Beide Ziele zuerst sichtbar machen.');
        el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      }
      const r = el.getBoundingClientRect();
      x = Math.max(0,r.left) + (Math.min(win.innerWidth,r.right)-Math.max(0,r.left))/2;
      y = Math.max(0,r.top) + (Math.min(win.innerHeight,r.bottom)-Math.max(0,r.top))/2;
      const hit = doc.elementFromPoint(x,y);
      if (!hit || hit !== el && !el.contains(hit)) throw new Error('Ziel ist verdeckt: ' + value.selector);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || x! < 0 || y! < 0 || x! >= win.innerWidth || y! >= win.innerHeight) throw new Error('Koordinaten liegen außerhalb der HTML-Vorschau.');
    const hit = doc.elementFromPoint(x!,y!);
    const label=hit?.closest('label');
    const labelled=label instanceof win.HTMLLabelElement ? label.control : null;
    if (!hit || hit.closest('input[type=file],[inert]') || hit.matches(':disabled') || labelled?.matches('input[type=file]')) throw new Error('An dieser Position gibt es kein bedienbares Vorschauziel.');
    return {x:Math.round(x!),y:Math.round(y!)};
  }
  function text(value: string, selector?: string, native = false) {
    const el = selector ? element(selector) : doc.activeElement;
    if (!el) throw new Error('Kein Eingabeziel fokussiert.');
    if (selector) focus(el);
    if (!value) return;
    if (!editable(el) && !(el instanceof win.HTMLElement && el.isContentEditable) || el.matches('[readonly],:disabled')) throw new Error('Texteingabe benötigt ein bearbeitbares Textfeld.');
    if (native) return;
    if (!el.dispatchEvent(new win.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:value}))) return;
    if (editable(el)) {
      if (!edited.has(el)) edited.set(el,el.value);
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
      // number/email inputs do not expose a range API.
      const next = el.value.slice(0,start) + value + el.value.slice(end);
      const setter = Object.getOwnPropertyDescriptor(el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype,'value')?.set;
      setter?.call(el,next);
      try { el.setSelectionRange(start+value.length,start+value.length); } catch { /* no text range */ }
    } else {
      const selection = win.getSelection();
      const range = selection?.rangeCount && el.contains(selection.anchorNode) ? selection.getRangeAt(0) : doc.createRange();
      if (!selection?.rangeCount || !el.contains(selection.anchorNode)) { range.selectNodeContents(el); range.collapse(false); }
      range.deleteContents(); const node = doc.createTextNode(value); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range);
    }
    el.dispatchEvent(new win.InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
  }
  function keyboardTarget() {
    const el=doc.activeElement;
    if(el?.matches('input[type=file]'))throw new Error('play kann keine Betriebssystem-Dateiauswahl bedienen.');
    if(!el || el===doc.body || el===doc.documentElement) inputs.target()?.focus({preventScroll:true});
  }
  function event(value: PreviewEvent) {
    if (value.type === 'type') { text(value.text,value.selector); return; }
    if ('key' in value) {
      const k = value.key, down = value.type === 'keyDown';
      if (!k || typeof k.key !== 'string' || !Array.isArray(k.modifiers)) throw new Error('Ungültiges Tastaturereignis.');
      keyboardTarget(); const active = doc.activeElement;
      const el = active && active !== doc.body && active !== doc.documentElement ? active : inputs.target() || doc.body;
      if (!el) throw new Error('Kein Tastaturziel.');
      const init = {key:k.key,code:k.code,bubbles:true,cancelable:true,ctrlKey:k.modifiers.includes('Control'),shiftKey:k.modifiers.includes('Shift'),altKey:k.modifiers.includes('Alt'),metaKey:k.modifiers.includes('Meta')};
      for (const modifier of down ? k.modifiers : []) el.dispatchEvent(new win.KeyboardEvent('keydown',{...init,key:modifier,code:modifier+'Left'}));
      const accepted = el.dispatchEvent(new win.KeyboardEvent(down?'keydown':'keyup',init));
      for (const modifier of down ? [] : [...k.modifiers].reverse()) el.dispatchEvent(new win.KeyboardEvent('keyup',{...init,key:modifier,code:modifier+'Left'}));
      if (!down || !accepted) return;
      if (k.key === 'Tab') {
        const list = [...doc.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]')].filter(e=>e.tabIndex>=0 && visible(e) && !e.matches(':disabled,[inert]') && !e.closest('[inert]'));
        if (list.length) { const i=list.indexOf(el as HTMLElement); focus(list[(i+(init.shiftKey?-1:1)+list.length)%list.length]); }
      } else if (editable(el)) {
        if (init.ctrlKey || init.metaKey) { if (k.key.toLowerCase()==='a') { try { el.select(); } catch { /* unavailable */ } } return; }
        const start=el.selectionStart ?? el.value.length, end=el.selectionEnd ?? start;
        if (k.key === 'Backspace' || k.key === 'Delete') {
          const from = k.key==='Backspace' && start===end ? Math.max(0,start-1) : start;
          const to = k.key==='Delete' && start===end ? Math.min(el.value.length,end+1) : end;
          if (el.readOnly || !el.dispatchEvent(new win.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:k.key==='Delete'?'deleteContentForward':'deleteContentBackward'}))) return;
          if (!edited.has(el)) edited.set(el,el.value);
          try { el.setRangeText('',from,to,'end'); } catch { return; }
          el.dispatchEvent(new win.InputEvent('input',{bubbles:true,inputType:k.key==='Delete'?'deleteContentForward':'deleteContentBackward'}));
        } else if (k.key.length===1) text(k.key);
        else if (k.key==='Enter' && el instanceof win.HTMLTextAreaElement) text('\n');
      } else if ((k.key==='Enter' || k.key===' ') && el instanceof win.HTMLElement && el.matches('button,a[href],input[type=button],input[type=submit],input[type=checkbox],input[type=radio]')) el.click();
      return;
    }
    const p = value.point;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Ungültige Mausposition.');
    const hit = doc.elementFromPoint(p.x,p.y);
    if (!hit) throw new Error('Mausziel liegt außerhalb der Vorschau.');
    if (value.type === 'scroll') {
      const wheel = new win.WheelEvent('wheel',{clientX:p.x,clientY:p.y,deltaX:value.delta_x,deltaY:value.delta_y,bubbles:true,cancelable:true});
      if (hit.dispatchEvent(wheel)) {
        let el: Element | null=hit;
        while(el && !(el.scrollHeight>el.clientHeight && /auto|scroll/.test(win.getComputedStyle(el).overflowY) || el.scrollWidth>el.clientWidth && /auto|scroll/.test(win.getComputedStyle(el).overflowX))) el=el.parentElement;
        if (el) el.scrollBy(value.delta_x,value.delta_y); else win.scrollBy(value.delta_x,value.delta_y);
      }
      return;
    }
    const button = value.button==='right'?2:value.button==='middle'?1:0, mask=button===2?2:button===1?4:1;
    if (value.type==='mouseDown') { buttons|=mask; held=hit; }
    const el = held || hit;
    if (value.type==='mouseUp') buttons&=~mask;
    const init={clientX:p.x,clientY:p.y,button,buttons,bubbles:true,cancelable:true,detail:value.count};
    if (value.type==='mouseMove' && hover!==hit) {
      hover?.dispatchEvent(new win.MouseEvent('mouseout',{...init,relatedTarget:hit}));
      hit.dispatchEvent(new win.MouseEvent('mouseover',{...init,relatedTarget:hover})); hover=hit;
    }
    const phase=value.type==='mouseDown'?'down':value.type==='mouseUp'?'up':'move';
    const accepted=el.dispatchEvent(new win.PointerEvent('pointer'+phase,{...init,pointerId:1,pointerType:'mouse',isPrimary:true}));
    if (accepted) el.dispatchEvent(new win.MouseEvent('mouse'+phase,init));
    if (value.type==='mouseDown' && accepted) focus(hit.closest('button,input,textarea,select,a[href],[tabindex],[contenteditable]')||hit);
    if (value.type==='mouseUp') {
      const same=held===hit || !!held?.contains(hit); held=null;
      if (same) {
        if (button===0) { hit.dispatchEvent(new win.MouseEvent('click',init)); if(value.count===2)hit.dispatchEvent(new win.MouseEvent('dblclick',init)); }
        else hit.dispatchEvent(new win.MouseEvent(button===2?'contextmenu':'auxclick',init));
      }
    }
  }
  function describe() {
    function selector(el: Element) {
      if(el.id && doc.querySelectorAll('#'+win.CSS.escape(el.id)).length===1)return '#'+win.CSS.escape(el.id);
      const parts:string[]=[]; let node:Element|null=el;
      while(node && node!==doc.documentElement){const siblings=node.parentElement?[...node.parentElement.children].filter(e=>e.tagName===node!.tagName):[node];parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(node)+1)+')');node=node.parentElement;}
      return 'html>'+parts.join('>');
    }
    const controls = 'button,input,textarea,a,select,canvas,[role=button],[contenteditable=true]';
    const outputs = 'output,progress,meter,[role=status],[role=alert],[aria-live],tbody tr,dt,dd';
    const candidates = new Set([...doc.querySelectorAll<HTMLElement>(outputs), ...doc.querySelectorAll<HTMLElement>('[data-testid], [data-test], [id]')]);
    const observations = [...candidates].filter(el =>
      !el.matches(controls) && visible(el) && !el.closest('script,style,noscript,[inert],[aria-hidden=true]')
      && (el.innerText?.trim() || 'value' in el)
      && (el.matches(outputs) || !el.querySelector(controls) && (el.innerText || '').length <= 1000),
    );
    return {title:doc.title,text:(doc.body?.innerText||'').slice(0,16000),viewport:{width:win.innerWidth,height:win.innerHeight},
      elements:[...doc.querySelectorAll<HTMLElement>(controls)].filter(visible).slice(0,80).map(el=>{
        const r=el.getBoundingClientRect();
        return {selector:selector(el),tag:el.tagName,text:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').slice(0,160),
          ...(el instanceof win.HTMLInputElement && el.type==='password'?{}:'value' in el?{value:String(el.value).slice(0,500)}:{}),
          ...(el instanceof win.HTMLInputElement && /^(checkbox|radio)$/.test(el.type)?{checked:el.checked}:{}),
          disabled:el.matches(':disabled'),focused:doc.activeElement===el,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
      }),
      observations:observations.slice(0,64).map(el=>{
        const text=(el.innerText||'').trim();
        return {selector:selector(el),tag:el.tagName,text:text.slice(0,500),...(text.length>500?{textTruncated:true}:{}),
          ...('value' in el?{value:String(el.value).slice(0,500)}:{})};
      }),observationsTruncated:observations.length>64};
  }
  function assert(action: PlayAction) {
    const matches=doc.querySelectorAll(action.selector!);
    if(action.count!==undefined && matches.length!==action.count)throw new Error(`Prüfung fehlgeschlagen: ${action.selector} — erwartet ${action.count} Elemente, erhalten ${matches.length}.`);
    const absent=matches.length===0;
    if(action.visible===false && absent && action.text===undefined && action.value===undefined && action.checked===undefined)return;
    if(action.count!==undefined && action.visible===undefined && action.text===undefined && action.value===undefined && action.checked===undefined)return;
    if(matches.length!==1)throw new Error(`Prüfung benötigt genau ein Element: ${action.selector} (${matches.length} gefunden).`);
    const el=matches[0] as HTMLElement & {value?:string;checked?:boolean};
    const compare = (property: string, expected: unknown, actual: unknown) => {
      if(expected===undefined || expected===actual)return;
      const secret=el instanceof win.HTMLInputElement && el.type==='password';
      const show=(value:unknown)=>secret?'[geschützt]':String(JSON.stringify(value)).slice(0,600);
      throw new Error(`Prüfung fehlgeschlagen: ${action.selector} (${property}) — erwartet ${show(expected)}, erhalten ${show(actual)}.`);
    };
    compare('visible',action.visible,visible(el));
    compare('text',action.text?.trim(),(el.innerText||el.textContent||'').trim());
    compare('value',action.value,typeof el.value==='number'?String(el.value):el.value);
    compare('checked',action.checked,el.checked);
  }
  return Object.freeze({ target, event, text, describe, assert, keyboardTarget, reset(){held=null;buttons=0;inputs.reset();} });
}
export type PreviewAutomation = ReturnType<typeof installPreviewAutomation>;
