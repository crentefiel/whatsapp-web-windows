'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function mockElement(id=''){
  return {
    id,disabled:false,hidden:false,value:'',textContent:'',children:[],scrollTop:0,scrollHeight:0,
    style:{},handlers:{},
    addEventListener(kind,fn){this.handlers[kind]=fn;},
    replaceChildren(...children){this.children=children;},
    append(...children){this.children.push(...children);},
    setAttribute(){},
  };
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('campo de texto aceita digitação offline e envio/anexos liberam após conectar',async()=>{
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,mockElement(id));return elements.get(id);};
  const sent=[],files=[],opened=[];let state='desconectado',onChange=null;
  const document={
    getElementById:get,
    createElement:()=>mockElement(),
    createDocumentFragment:()=>mockElement()
  };
  const window={whatsapp:{
    status:async()=>({state,received:0,errors:0}),
    conversations:async()=>[{jid:'5511999999999@s.whatsapp.net',name:'Contato de teste',preview:'Oi'}],
    messages:async()=>[],
    sendText:async(jid,message)=>{sent.push({jid,message});},
    sendFile:async(jid,kind)=>{files.push({jid,kind});},
    openContactFolder:async jid=>{opened.push(jid);},
    onChange:callback=>{onChange=callback;}
  }};
  const code=fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8');
  vm.runInNewContext(code,{document,window,Date,console});
  await tick();
  assert.equal(get('messageInput').disabled,true,'sem contato não se pode escrever');
  const contact=get('conversations').children[0];
  assert.ok(contact,'contato individual deve aparecer');
  contact.handlers.click();
  await tick();
  assert.equal(get('messageInput').disabled,false,'com contato selecionado pode escrever offline');
  assert.equal(get('sendButton').disabled,true);
  assert.equal(get('sendFile').disabled,true);
  get('messageInput').value='Olá depois de reconectar';
  get('messageInput').handlers.input();
  assert.equal(get('sendButton').disabled,true,'não enviar enquanto desconectado');
  state='conectado';onChange('status');
  await tick();
  assert.equal(get('sendButton').disabled,false,'pode enviar texto quando conectado');
  assert.equal(get('sendFile').disabled,false,'pode anexar quando conectado');
  await get('sendForm').handlers.submit({preventDefault(){}});
  assert.equal(sent.length,1);
  assert.equal(sent[0].message,'Olá depois de reconectar');
  await get('sendFile').handlers.click();
  assert.equal(files.length,1);
  assert.equal(files[0].jid,'5511999999999@s.whatsapp.net');
});
