import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream} from 'node:fs';
import path from 'node:path';

const root=process.cwd(),directory=path.join(root,'work/redteam-sandbox');
mkdirSync(directory,{recursive:true});
const log=createWriteStream(path.join(root,'work/redteam-soak-server.log'));
const server=spawn(process.execPath,[path.join(root,'work/redteam-release/dist-server/index.js')],{
  cwd:directory,env:{...process.env,PORT:'3479',UDP_PORT:'20888',APP_ORIGIN:'https://127.0.0.1:3480'},stdio:['ignore','pipe','pipe'],
});
server.stdout.pipe(log);server.stderr.pipe(log);
let finished=false,load;
server.on('exit',(code,signal)=>{console.log('Server exited',code,signal);if(!finished){load?.kill();process.exitCode=1;}});
try{
  for(let attempt=0;;attempt++){
    try{const r=await fetch('http://127.0.0.1:3479/api/health');if(r.ok)break;}catch{}
    if(attempt>=100)throw Error('Soak server did not start');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  load=spawn(process.execPath,['scripts/redteam-soak.mjs'],{cwd:root,env:process.env,stdio:'inherit'});
  const code=await new Promise(resolve=>load.on('exit',resolve));
  finished=true;process.exitCode=code??1;
}finally{server.kill('SIGTERM');}
