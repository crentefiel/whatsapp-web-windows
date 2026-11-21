'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const JID='5511999999999@s.whatsapp.net';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const elem=id=>({
 id,hidden:false,disabled:false,value:'',textContent:'',children:[],style:{},handlers:{},checked:false,
 setAttribute(){},focus(){},replaceChildren(...children){this.children=children;},
 append(...children){this.children.push(...children);},
 addEventListener(kind,fn){this.handlers[kind]=fn;}
});
test('modo observação, importação, sugestão editável e correção funcionam na UI sem enviar sozinhos',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,elem(id));return elements.get(id);};
 get('settingsPanel').hidden=true;
 const calls={send:[],modes:[],examples:[],rules:[],approved:[],rebuild:0,approveRules:[]};
 let mode='observation',suggestion={id:17,jid:JID,question_id:'q1',answer:'Sugestão de teste',status:'pending'};
 const whatsapp={
  status:async()=>({state:'conectado'}),conversations:async()=>[{jid:JID,name:'Cliente',preview:'Oi'}],
  messages:async()=>[],onChange:callback=>{whatsapp.changed=callback;},
  aiSettings:async()=>({enabled:true,baseUrl:'http://localhost:11434/v1',model:'auto',systemPrompt:'Seja breve',allowedJids:[],responseScope:'all',hasKey:false}),
  aiDiagnostics:async()=>({}),
  learnStats:async()=>({mode,examples:1,approved:0,approvedRules:0,contacts:1}),
  learnMode:async next=>{calls.modes.push(next);
   if(next==='automatic')return{canceled:true,mode};
   mode=next;return{canceled:false,mode};},
  learnExamples:async()=>[{id:2,question:'Qual o horário?',reply:'Das 9h às 17h',status:'observed',source:'human'}],
  learnExampleUpdate:async(...args)=>{calls.approved.push(args);return true;},
  learnRules:async()=>[{id:3,jid:null,content:'Fechamos aos domingos',state:'draft'}],
  learnApproveRule:async(...args)=>{calls.approveRules.push(args);return true;},
  learnAddRule:async(...args)=>{calls.rules.push(args);return 4;},
  learnRebuild:async()=>{calls.rebuild++;return{imported:7,total:19};},
  learnSuggestion:async()=>suggestion,
  learnSendSuggestion:async(...args)=>{calls.send.push(args);suggestion=null;return{id:'sent'};},
  learnRejectSuggestion:async()=>{suggestion=null;return true;}
 };
 const document={getElementById:get,createElement:()=>elem(),createDocumentFragment:()=>elem(),addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8'),{window:{whatsapp},document,Date,console});
 await tick();await tick();await tick();
 assert.equal(get('learnMode').value,'observation');
 assert.equal(get('learnSuggestion').hidden,true);
 assert.match(get('learnModeHint').textContent,/não sugere nem envia/);
 await get('conversations').children[0].handlers.click();await tick();await tick();
 assert.equal(get('learnExamples').children.length,1);
 assert.equal(get('learnRules').children.length,1);
 assert.equal(calls.send.length,0);
 const ruleCard=get('learnRules').children[0];
 await ruleCard.children[2].children[0].handlers.click();await tick();
 assert.deepEqual(calls.approveRules,[[3,true]]);
 await get('learnBackfill').handlers.click();await tick();
 assert.equal(calls.rebuild,1);
 assert.match(get('learnResult').textContent,/7 novos exemplos/);
 get('learnMode').value='suggestion';
 await get('learnMode').handlers.change();await tick();await tick();
 assert.equal(mode,'suggestion');
 assert.equal(get('learnSuggestion').hidden,false);
 assert.equal(get('learnSuggestionText').value,'Sugestão de teste');
 assert.equal(calls.send.length,0,'a IA não envia antes da aprovação');
 get('learnSuggestionText').value='Resposta corrigida manualmente';
 await get('learnSendSuggestion').handlers.click();await tick();
 assert.deepEqual(calls.send,[[17,JID,'Resposta corrigida manualmente']]);
 assert.equal(get('learnSuggestion').hidden,true);
 const card=get('learnExamples').children[0];
 card.children[2].value='Resposta ensinada pelo dono';
 await card.children[3].children[0].handlers.click();await tick();
 assert.deepEqual(calls.approved.at(-1),[2,'Resposta ensinada pelo dono','approved']);
 get('learnMode').value='automatic';
 await get('learnMode').handlers.change();
 assert.equal(get('learnMode').value,'suggestion','cancelamento não ativa o automático');
});
