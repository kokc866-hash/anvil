import {load,dump,FAILSAFE_SCHEMA} from 'js-yaml';
export {debugKnowledgeSkill} from './knowledge-skill-check.mjs';
/** @param {{name:string,when:string,body:string,kind:string,scope:string,frontmatter?:string}} skill */
export function serializeKnowledgeSkill(skill){
 const existing=load(skill.frontmatter||'{}',{schema:FAILSAFE_SCHEMA});
 const extras=existing&&typeof existing==='object'&&!Array.isArray(existing)?Object.fromEntries(Object.entries(existing).filter(([key])=>!['name','description','when','kind','scope'].includes(key))):{};
 const head=dump({name:skill.name,description:skill.when||skill.name,when:skill.when||skill.name,kind:skill.kind,scope:skill.scope,...extras},{schema:FAILSAFE_SCHEMA,lineWidth:-1});
 return `---\n${head}---\n${skill.body}\n`;
}
