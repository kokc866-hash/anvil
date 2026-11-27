/** User corrections are delivered at tool boundaries, never replaying an action. */
export type SteeringMessage = Readonly<{id:string;text:string;createdAt:number;images?:readonly string[]}>;
const attachedImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const maxEncodedImage = 7 * 1024 * 1024;
export class AgentSteeringInbox {
  private pending:SteeringMessage[]=[];
  private seen=new Set<string>();
  readonly owner:string;
  private valid:()=>boolean;
  constructor(owner:string,valid:()=>boolean=()=>true){this.owner=owner;this.valid=valid;}
  enqueue(message:SteeringMessage):{ok:boolean;duplicate?:boolean;error?:string}{
    if(!this.valid())return {ok:false,error:'Der Auftrag ist nicht mehr aktiv.'};
    if(!message||!/^[-\w:.]{1,120}$/.test(message.id)||typeof message.text!=='string'||!message.text.trim()||message.text.length>8000)
      return {ok:false,error:'Die Korrektur benötigt Text mit höchstens 8000 Zeichen.'};
    if(this.seen.has(message.id))return {ok:true,duplicate:true};
    if(this.pending.length>=16||this.seen.size>=256)return {ok:false,error:'Zu viele Korrekturen. Warte auf die nächste Modellrunde.'};
    const images = message.images;
    if (images && (!Array.isArray(images) || images.length > 4 || images.some(url => typeof url !== 'string' || url.length > maxEncodedImage || !attachedImage.test(url)))) {
      return { ok: false, error: 'Korrekturen akzeptieren bis zu vier Bilder als PNG, JPEG, WebP oder GIF. Dein Entwurf bleibt erhalten.' };
    }
    const imageSize = (urls?: readonly string[]) => urls?.reduce((size, url) => size + url.length, 0) ?? 0;
    if (images?.length && this.pending.reduce((size, item) => size + imageSize(item.images), imageSize(images)) > 4 * maxEncodedImage) {
      return { ok: false, error: 'Zu viele Bilddaten warten auf die nächste Modellrunde. Dein Entwurf bleibt erhalten.' };
    }
    this.seen.add(message.id);
    this.pending.push(Object.freeze({ ...message, text: message.text.trim(), ...(images?.length && { images: Object.freeze([...images]) }) }));
    return { ok: true };
  }
  drain():SteeringMessage[]{
    if(!this.valid()){this.pending=[];return [];}
    const result=this.pending;this.pending=[];return result;
  }
  get size(){return this.pending.length;}
}

let foreground:{project:string;inbox:AgentSteeringInbox;imageError:string}|undefined;
export function openForegroundSteering(project:string,owner:string,valid:()=>boolean,imageError=''){
  const inbox=new AgentSteeringInbox(owner,valid),entry={project,inbox,imageError};foreground=entry;
  return {inbox,close:()=>{if(foreground===entry)foreground=undefined;}};
}
export function steerForeground(project:string,text:string,id:string=globalThis.crypto.randomUUID(),images?:readonly string[]):{ok:boolean;duplicate?:boolean;error?:string}{
  if(!foreground||foreground.project!==project)return {ok:false,error:'Kein passender laufender Auftrag. Dein Entwurf bleibt erhalten.'};
  if(images?.length&&foreground.imageError)return {ok:false,error:foreground.imageError};
  return foreground.inbox.enqueue({id,text,createdAt:Date.now(),images});
}
export function steeringProject(value:{workspaceCwd?:string;companionUrl?:string;workspaceMemoryId?:string;workspaceEpoch?:number}):string{
  return JSON.stringify([value.workspaceCwd?.replaceAll('\\','/').replace(/\/$/,'')||value.workspaceMemoryId||'',value.companionUrl||'',value.workspaceEpoch??0]);
}
export function steeringPrompt(messages:readonly SteeringMessage[]):string{
  return messages.map(message=>`User correction (${message.id}):\n${message.text}`).join('\n\n')+
    '\n\nApply these current user corrections to the existing task. Confirmed actions remain done. Do not repeat completed actions. Continue from the current project state.';
}
