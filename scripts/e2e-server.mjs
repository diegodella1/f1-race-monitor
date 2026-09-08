import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

mkdirSync('work',{recursive:true});
const build=path.resolve(process.env.E2E_BUILD_DIR??'.'),directory=mkdtempSync(path.resolve('work/e2e-'));
cpSync(path.join(build,'dist'),path.join(directory,'dist'),{recursive:true});
const key=path.join(directory,'key.pem'),cert=path.join(directory,'cert.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
const origin='https://127.0.0.1:3490';
writeFileSync('work/e2e-context.json',JSON.stringify({directory,build,origin}));
const child=spawn(process.execPath,[path.join(build,'dist-server/index.js')],{cwd:directory,env:{...process.env,PORT:'3491',UDP_PORT:'20999',APP_ORIGIN:origin},stdio:'inherit'});
const proxy=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:3491,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
proxy.on('upgrade',(req,socket,head)=>{
  const upstream=net.connect(3491,'127.0.0.1',()=>{
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries({...req.headers,'x-forwarded-proto':'https'}).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
  });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});
proxy.listen(3490,'127.0.0.1');
function close(){child.kill('SIGTERM');proxy.close();}
process.once('SIGTERM',close);process.once('SIGINT',close);child.on('exit',()=>{proxy.close();process.exit();});
