'use strict';
const fs=require('node:fs'),path=require('node:path');
// Apenas retoma uma sessão Baileys já salva; nunca apaga ou exporta credenciais.
function hasSavedBaileysSession(dataDir){
  try{
    const file=path.join(dataDir,'baileys_auth','creds.json');
    const stat=fs.statSync(file);
    return stat.isFile()&&stat.size>0;
  }catch{return false;}
}
module.exports={hasSavedBaileysSession};
