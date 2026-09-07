import type { RadioEvent } from './radio-events.js';
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

  constructor(path:string,private readOnly=false){
    if(readOnly){this.db=new DatabaseSync(path,{readOnly:true});return;}
    mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER, track TEXT, mode TEXT NOT NULL, laps INTEGER DEFAULT 0, packets INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), recorded_at INTEGER NOT NULL, lap INTEGER, state_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decision_events(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), recorded_at INTEGER NOT NULL, lap INTEGER NOT NULL, source TEXT NOT NULL, event_id TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, score INTEGER, confidence INTEGER, priority TEXT, title TEXT, category TEXT, UNIQUE(session_id,source,event_id,lap,status)); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_snapshots_session_time ON snapshots(session_id, recorded_at); CREATE INDEX IF NOT EXISTS idx_decisions_session_time ON decision_events(session_id, recorded_at);`);
    this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS radio_events(
        id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id),
        event_id TEXT NOT NULL, device_id TEXT NOT NULL, message_id TEXT NOT NULL,
        status TEXT NOT NULL, text TEXT NOT NULL, reason TEXT NOT NULL, category TEXT NOT NULL,
        lap INTEGER NOT NULL, client_at INTEGER NOT NULL, server_at INTEGER NOT NULL,
        UNIQUE(device_id,event_id));
      CREATE INDEX IF NOT EXISTS idx_radio_session_device ON radio_events(session_id,device_id,id);
      CREATE INDEX IF NOT EXISTS idx_radio_session_time ON radio_events(session_id,id);
      INSERT OR IGNORE INTO schema_migrations VALUES(1,'radio delivery history');
      COMMIT;`);
    this.addColumn('sessions','session_uid','TEXT');
    this.addColumn('sessions','session_link_id','INTEGER DEFAULT 0');
    this.addColumn('decision_events','score','INTEGER');
    this.addColumn('decision_events','confidence','INTEGER');
    this.addColumn('decision_events','priority','TEXT');
    this.addColumn('decision_events','title','TEXT');
    this.addColumn('decision_events','category','TEXT');
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
    const decisionInsert=this.db.prepare('INSERT OR IGNORE INTO decision_events(session_id,recorded_at,lap,source,event_id,status,reason,score,confidence,priority,title,category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const [source,entries] of [['strategy',state.strategy.decisions],['engineer',state.engineer.log]] as const)for(const entry of entries){
      const decisionKey=source+':'+entry.id+':'+entry.lap+':'+entry.status;
      if(!this.savedDecisionKeys.has(decisionKey)){decisionInsert.run(this.sessionId,entry.at,entry.lap,source,entry.id,entry.status,entry.reason,entry.score??null,entry.confidence??null,entry.priority??null,entry.title??null,entry.category??null);this.savedDecisionKeys.add(decisionKey);}
    }
    const terminal=['FINISHED','RETIRED'].includes(state.context.lifecycle);
    if(!terminal&&state.updatedAt-this.lastSave<2000)return;
    this.lastSave=state.updatedAt;
    this.db.prepare('INSERT INTO snapshots(session_id,recorded_at,lap,state_json) VALUES(?,?,?,?)').run(this.sessionId,state.updatedAt,state.lap,JSON.stringify(state));
    this.db.prepare('UPDATE sessions SET track=?,mode=?,laps=?,packets=? WHERE id=?').run(state.track,state.sessionType,state.lap,state.packetCount,this.sessionId);
  }

  stop(at=Date.now()){
    if(this.sessionId)this.db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(at,this.sessionId);
    this.sessionId=null;
    this.sessionKey='';
    this.lastSave=0;
    this.savedDecisionKeys.clear();
  }

  close(){if(!this.readOnly)this.stop();this.db.close();}

  saveRadioEvents(events:RadioEvent[]){
    const session=this.db.prepare('SELECT id FROM sessions WHERE session_uid=? AND session_link_id=? AND mode=? ORDER BY id DESC LIMIT 1');
    const insert=this.db.prepare('INSERT OR IGNORE INTO radio_events(session_id,event_id,device_id,message_id,status,text,reason,category,lap,client_at,server_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    let accepted=0;
    this.db.exec('BEGIN');
    try{
      for(const event of events){
        const row=session.get(event.sessionUid,event.sessionLinkId,event.sessionType) as {id:number}|undefined;
        if(!row)continue;
        accepted+=Number(insert.run(row.id,event.eventId,event.deviceId,event.messageId,event.status,event.text,event.reason,event.category,event.lap,event.clientAt,Date.now()).changes);
      }
      this.db.exec('COMMIT');return accepted;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  acknowledgedRadioEvents(events:RadioEvent[]){
    const query=this.db.prepare('SELECT 1 FROM radio_events WHERE device_id=? AND event_id=?');
    return events.filter(event=>query.get(event.deviceId,event.eventId)).map(event=>event.eventId);
  }

  radioEvents(sessionId:number,query:{limit?:number;offset?:number;device?:string;status?:string;category?:string;lap?:number}={}){
    const {limit=50,offset=0,device='',status='',category='',lap=-1}=query;
    const params=[sessionId,device,device,status,status,category,category,lap,lap];
    const where="session_id=? AND (?='' OR device_id=?) AND (?='' OR status=?) AND (?='' OR category=?) AND (?<0 OR lap=?)";
    const total=this.db.prepare('SELECT COUNT(*) AS count FROM radio_events WHERE '+where).get(...params) as {count:number};
    const events=this.db.prepare('SELECT id,event_id AS eventId,device_id AS deviceId,message_id AS messageId,status,text,reason,category,lap,client_at AS clientAt,server_at AS serverAt FROM radio_events WHERE '+where+' ORDER BY id DESC LIMIT ? OFFSET ?').all(...params,Math.max(1,Math.min(200,limit)),Math.max(0,offset));
    const devices=this.db.prepare('SELECT DISTINCT device_id AS deviceId FROM radio_events WHERE session_id=? ORDER BY device_id').all(sessionId);
    return {events,total:total.count,devices};
  }

  radioReport(sessionId:number){
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='radio_events'").get())return {counts:[],silences:[],latencies:[]};
    const counts=this.db.prepare('SELECT device_id AS deviceId,status,reason,COUNT(*) AS count FROM radio_events WHERE session_id=? GROUP BY device_id,status,reason').all(sessionId);
    const silences=this.db.prepare(`WITH deliveries AS (
      SELECT device_id,client_at,LAG(client_at) OVER(PARTITION BY device_id ORDER BY client_at) AS previous
      FROM radio_events WHERE session_id=? AND status='STARTED'
    ) SELECT device_id AS deviceId,previous AS fromAt,client_at AS toAt,client_at-previous AS durationMs FROM deliveries WHERE client_at-previous>=45000`).all(sessionId);
    const times=this.db.prepare(`SELECT device_id AS deviceId,message_id AS messageId,
      MIN(CASE WHEN status='SELECTED' THEN client_at END) AS selectedAt,
      MIN(CASE WHEN status='SUBMITTED' THEN client_at END) AS submittedAt,
      MIN(CASE WHEN status='STARTED' THEN client_at END) AS startedAt
      FROM radio_events WHERE session_id=? GROUP BY device_id,message_id`).all(sessionId) as {deviceId:string;messageId:string;selectedAt:number|null;submittedAt:number|null;startedAt:number|null}[];
    const latencies=times.map(row=>({deviceId:row.deviceId,messageId:row.messageId,
      queueMs:row.submittedAt!==null&&row.selectedAt!==null?Math.max(0,row.submittedAt-row.selectedAt):null,
      speechStartupMs:row.startedAt!==null&&row.submittedAt!==null?Math.max(0,row.startedAt-row.submittedAt):null,
      totalMs:row.startedAt!==null&&row.selectedAt!==null?Math.max(0,row.startedAt-row.selectedAt):null}));
    return {counts,silences,latencies};
  }

  list(){return this.db.prepare('SELECT id,started_at AS startedAt,ended_at AS endedAt,track,mode,laps,packets FROM sessions ORDER BY started_at DESC LIMIT 20').all();}
  decisions(sessionId:number){return this.db.prepare('SELECT recorded_at AS recordedAt,lap,source,event_id AS eventId,status,reason,score,confidence,priority,title,category FROM decision_events WHERE session_id=? ORDER BY recorded_at').all(sessionId);}
  replay(sessionId:number,limit=2500){const rows=this.db.prepare('SELECT recorded_at AS recordedAt,lap,state_json AS stateJson FROM snapshots WHERE session_id=? ORDER BY recorded_at LIMIT ?').all(sessionId,Math.max(1,Math.min(10000,limit))) as {recordedAt:number;lap:number;stateJson:string}[];return rows.map(row=>({recordedAt:row.recordedAt,lap:row.lap,state:JSON.parse(row.stateJson) as RaceState}));}
  report(sessionId:number){
    const session=this.db.prepare('SELECT id,started_at AS startedAt,ended_at AS endedAt,track,mode,laps,packets FROM sessions WHERE id=?').get(sessionId);
    if(!session)return null;
    const snapshots=this.db.prepare(`SELECT COUNT(*) AS frames,ROUND(AVG(CAST(json_extract(state_json,'$.telemetry.score') AS REAL)),1) AS averageTelemetryScore,MIN(CAST(json_extract(state_json,'$.telemetry.score') AS INTEGER)) AS minimumTelemetryScore FROM snapshots WHERE session_id=?`).get(sessionId);
    const decisions=this.db.prepare('SELECT source,status,COUNT(*) AS count FROM decision_events WHERE session_id=? GROUP BY source,status').all(sessionId) as {source:string;status:string;count:number}[];
    return {session,snapshots,radio:this.radioReport(sessionId),decisions:Object.fromEntries(decisions.map(row=>[row.source+':'+row.status,row.count]))};
  }
  loadSettings(defaults:Settings){const rows=this.db.prepare('SELECT key,value FROM settings').all() as {key:string,value:string}[];const saved=Object.fromEntries(rows.map(r=>[r.key,JSON.parse(r.value)]));return {...defaults,...saved} as Settings;}
  saveSettings(settings:Settings){const statement=this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const [key,value] of Object.entries(settings))statement.run(key,JSON.stringify(value));}
}
