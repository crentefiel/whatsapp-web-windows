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

// Preserva a autenticação antiga antes de pedir um novo QR.
// Esta função só deve ser chamada após uma confirmação explícita do usuário.
function archiveBaileysSession(dataDir){
  const source=path.join(dataDir,'baileys_auth');
  if(!fs.existsSync(source))return null;
  const stat=fs.statSync(source);
  if(!stat.isDirectory())throw Error('Pasta de autenticação inválida');
  let destination;
  do{
    destination=path.join(dataDir,'baileys_auth_backup_'+Date.now()+'_'+require('node:crypto').randomBytes(4).toString('hex'));
  }while(fs.existsSync(destination));
  fs.renameSync(source,destination);
  return destination;
}
module.exports={hasSavedBaileysSession,archiveBaileysSession};
