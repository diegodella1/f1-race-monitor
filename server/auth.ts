import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const SESSION_MS=30*24*60*60*1000;
export class DeviceAuth {
  private db:DatabaseSync;
  constructor(file:string){
    mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS pairing_tokens(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_migrations VALUES(1);`);
  }
  pair(now=Date.now()){
    this.db.prepare('DELETE FROM pairing_tokens WHERE expires<=?').run(now);
    const token=randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO pairing_tokens VALUES(?,?)').run(hash(token),now+600000);
    return token;
  }
  redeem(token:string,name:string,now=Date.now()){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare('DELETE FROM pairing_tokens WHERE hash=? AND expires>? RETURNING hash').get(hash(token),now);
      if(!row){this.db.exec('ROLLBACK');return null;}
      const secret=randomBytes(32).toString('base64url'),id=randomUUID();
      this.db.prepare('INSERT INTO devices VALUES(?,?,?,?,?)').run(id,name,hash(secret),now+SESSION_MS,now);
      this.db.exec('COMMIT');return {id,secret};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  device(secret:string,now=Date.now()){
    return this.db.prepare('SELECT id,name,expires FROM devices WHERE hash=? AND expires>?').get(hash(secret),now) as {id:string;name:string;expires:number}|undefined;
  }
  list(){return this.db.prepare('SELECT id,name,created,expires FROM devices ORDER BY created').all();}
  revoke(id:string){this.db.prepare('DELETE FROM devices WHERE id=?').run(id);}
  close(){this.db.close();}
}
export const sessionCookie=(cookie='')=>cookie.split(';').map(item=>item.trim()).find(item=>item.startsWith('f1_session='))?.slice(11)??'';

export class RateLimit {
  private windows=new Map<string,{count:number;until:number}>();
  allow(key:string,limit:number,now=Date.now()){
    if(this.windows.size>10000)for(const [key,value] of this.windows)if(value.until<=now)this.windows.delete(key);
    let value=this.windows.get(key);
    if(!value||value.until<=now){
      if(this.windows.size>=20000&&!value)return false;
      value={count:0,until:now+60000};this.windows.set(key,value);
    }
    return ++value.count<=limit;
  }
}
