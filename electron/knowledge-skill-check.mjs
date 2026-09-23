/** @param {{name:string,when:string,body:string,fails?:number}} skill */
export function debugKnowledgeSkill(skill){
 const issues=[];const name=skill.name.trim(),when=skill.when.trim(),body=skill.body.trim();
 if(name.length<3)issues.push('Name zu kurz');
 if(/\s/.test(name))issues.push('Name ohne Leerzeichen (kebab-case)');
 if(when.split(/\s+/).filter(word=>word.length>2).length<2)issues.push('when braucht mehrere Trigger-Wörter');
 if(body.length<8)issues.push('Anweisung fehlt oder ist zu kurz');
 if((skill.fails??0)>=3)issues.push('mehrfach fehlgeschlagen — Schritte prüfen, nicht blind wiederholen');
 return {ok:issues.length===0,issues};
}
