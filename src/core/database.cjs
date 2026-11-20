'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
class Store {
  constructor(folder){
    fs.mkdirSync(folder,{recursive:true});
    this.db=new DatabaseSync(path.join(folder,'conversas.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS contacts(jid TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',photo TEXT DEFAULT NULL,last_seen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages(jid TEXT NOT NULL,id TEXT NOT NULL,participant TEXT NOT NULL DEFAULT '',from_me INTEGER NOT NULL,timestamp INTEGER NOT NULL,
        kind TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',quoted_id TEXT,media_id TEXT,PRIMARY KEY(jid,id,participant));
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(jid,timestamp DESC,id DESC);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,kind TEXT NOT NULL,relative_path TEXT NOT NULL,size INTEGER NOT NULL);`);
    this.upsertContactStmt=this.db.prepare(`INSERT INTO contacts(jid,name,last_seen) VALUES(?,?,?)
      ON CONFLICT(jid) DO UPDATE SET name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE contacts.name END,
      last_seen=MAX(contacts.last_seen,excluded.last_seen)`);
    this.insertMsgStmt=this.db.prepare(`INSERT OR IGNORE INTO messages(jid,id,participant,from_me,timestamp,kind,body,quoted_id,media_id) VALUES(?,?,?,?,?,?,?,?,?)`);
    this.hasStmt=this.db.prepare('SELECT 1 AS found FROM messages WHERE jid=? AND id=? AND participant=?');
  }
  contact(jid,name='',timestamp=0){this.upsertContactStmt.run(jid,String(name).slice(0,200),Number(timestamp)||0);}
  has(m){return !!this.hasStmt.get(m.jid,m.id,m.participant);}
  save(m,mediaId=null){
    if(this.has(m))return false;
    this.db.exec('BEGIN');
    try{
      this.contact(m.jid,(m.fromMe||m.jid.endsWith('@g.us'))?'':m.senderName,m.timestamp);
      this.insertMsgStmt.run(m.jid,m.id,m.participant,Number(m.fromMe),m.timestamp,m.type,m.text,m.quotedId,mediaId);
      this.db.exec('COMMIT');return true;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  saveMedia(m){this.db.prepare('INSERT OR REPLACE INTO media(id,filename,mime,kind,relative_path,size) VALUES(?,?,?,?,?,?)').run(m.id,m.filename,m.mime,m.kind,m.relativePath,m.size);}
  getMedia(id){return this.db.prepare('SELECT * FROM media WHERE id=?').get(id);}
  photo(jid,url){this.db.prepare('INSERT INTO contacts(jid,photo) VALUES(?,?) ON CONFLICT(jid) DO UPDATE SET photo=excluded.photo').run(jid,url);}
  conversations(limit=200){return this.db.prepare(`SELECT c.jid,c.name,c.photo,c.last_seen,
    (SELECT body FROM messages WHERE jid=c.jid ORDER BY timestamp DESC,id DESC LIMIT 1) AS preview,
    (SELECT kind FROM messages WHERE jid=c.jid ORDER BY timestamp DESC,id DESC LIMIT 1) AS preview_kind,
    (SELECT COUNT(*) FROM messages WHERE jid=c.jid) AS count
    FROM contacts c ORDER BY c.last_seen DESC LIMIT ?`).all(limit);}
  messages(jid,limit=200){return this.db.prepare(`SELECT m.*,d.filename,d.mime,d.kind AS media_kind FROM messages m
    LEFT JOIN media d ON d.id=m.media_id WHERE m.jid=? ORDER BY m.timestamp DESC,m.id DESC LIMIT ?`).all(jid,limit).reverse();}
  close(){this.db.close();}
}
module.exports={Store};
