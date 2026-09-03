import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RaceState, Settings } from './types.js';

export class SessionStore {
  private db:DatabaseSync;
  private sessionId:number|null=null;
  private sessionKey='';
  private lastSave=0;
  private savedDecisionKeys=new Set<string>();

  constructor(path:string){
    mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER, track TEXT, mode TEXT NOT NULL, laps INTEGER DEFAULT 0, packets INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), recorded_at INTEGER NOT NULL, lap INTEGER, state_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decision_events(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), recorded_at INTEGER NOT NULL, lap INTEGER NOT NULL, source TEXT NOT NULL, event_id TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, UNIQUE(session_id,source,event_id,lap,status)); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_snapshots_session_time ON snapshots(session_id, recorded_at); CREATE INDEX IF NOT EXISTS idx_decisions_session_time ON decision_events(session_id, recorded_at);`);
    this.addColumn('sessions','session_uid','TEXT');
    this.addColumn('sessions','session_link_id','INTEGER DEFAULT 0');
    this.db.exec(`UPDATE sessions SET ended_at=COALESCE((SELECT MAX(recorded_at) FROM snapshots WHERE session_id=sessions.id),started_at) WHERE ended_at IS NULL; UPDATE sessions SET mode=COALESCE((SELECT json_extract(state_json,'$.sessionType') FROM snapshots WHERE session_id=sessions.id AND json_extract(state_json,'$.sessionType')!='Unknown' ORDER BY recorded_at DESC LIMIT 1),mode) WHERE mode='Unknown'; PRAGMA optimize;`);
  }

  private addColumn(table:string,column:string,declaration:string){
    const columns=this.db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];
    if(!columns.some(x=>x.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }

  private key(state:RaceState){return `${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`;}

  private start(state:RaceState){
    const result=this.db.prepare('INSERT INTO sessions(started_at,track,mode,session_uid,session_link_id) VALUES(?,?,?,?,?)').run(state.updatedAt,state.track,state.sessionType,state.sessionUid,state.sessionLinkId);
    this.sessionId=Number(result.lastInsertRowid);
    this.sessionKey=this.key(state);
    this.lastSave=0;
    this.savedDecisionKeys.clear();
  }

  save(state:RaceState){
    if(state.context.category==='UNKNOWN'||!state.sessionUid||!state.sessionLinkId||state.track.startsWith('Waiting'))return;
    const key=this.key(state);
    if(this.sessionId&&this.sessionKey!==key)this.stop(state.updatedAt);
    if(!this.sessionId)this.start(state);
    if(Date.now()-this.lastSave<5000)return;
    this.lastSave=Date.now();
    this.db.prepare('INSERT INTO snapshots(session_id,recorded_at,lap,state_json) VALUES(?,?,?,?)').run(this.sessionId,state.updatedAt,state.lap,JSON.stringify(state));
    this.db.prepare('UPDATE sessions SET track=?,mode=?,laps=?,packets=? WHERE id=?').run(state.track,state.sessionType,state.lap,state.packetCount,this.sessionId);
    const decisionInsert=this.db.prepare('INSERT OR IGNORE INTO decision_events(session_id,recorded_at,lap,source,event_id,status,reason) VALUES(?,?,?,?,?,?,?)');
    for(const [source,entries] of [['strategy',state.strategy.decisions],['engineer',state.engineer.log]] as const)for(const entry of entries){
      const decisionKey=source+':'+entry.id+':'+entry.lap+':'+entry.status;
      if(!this.savedDecisionKeys.has(decisionKey)){decisionInsert.run(this.sessionId,entry.at,entry.lap,source,entry.id,entry.status,entry.reason);this.savedDecisionKeys.add(decisionKey);}
    }
  }

  stop(at=Date.now()){
    if(this.sessionId)this.db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(at,this.sessionId);
    this.sessionId=null;
    this.sessionKey='';
    this.lastSave=0;
    this.savedDecisionKeys.clear();
  }

  close(){this.stop();this.db.close();}

  list(){return this.db.prepare('SELECT id,started_at AS startedAt,ended_at AS endedAt,track,mode,laps,packets FROM sessions ORDER BY started_at DESC LIMIT 20').all();}
  decisions(sessionId:number){return this.db.prepare('SELECT recorded_at AS recordedAt,lap,source,event_id AS eventId,status,reason FROM decision_events WHERE session_id=? ORDER BY recorded_at').all(sessionId);}
  loadSettings(defaults:Settings){const rows=this.db.prepare('SELECT key,value FROM settings').all() as {key:string,value:string}[];const saved=Object.fromEntries(rows.map(r=>[r.key,JSON.parse(r.value)]));return {...defaults,...saved} as Settings;}
  saveSettings(settings:Settings){const statement=this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const [key,value] of Object.entries(settings))statement.run(key,JSON.stringify(value));}
}
