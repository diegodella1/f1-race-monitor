import { useEffect,useState } from 'react';
type Device={id:string;name:string;expires:number};
export function DeviceSettings(){
  const [devices,setDevices]=useState<Device[]>([]),[link,setLink]=useState(''),[error,setError]=useState('');
  const load=async()=>{const r=await fetch('/api/auth/devices');if(!r.ok)throw Error('Could not load devices');setDevices(await r.json());};
  useEffect(()=>{void load().catch(e=>setError(String(e)));},[]);
  async function action(path:string,method:string){try{const r=await fetch(path,{method});if(!r.ok)throw Error('Device operation failed');const body=await r.json();if(body.url)setLink(body.url);await load();}catch(error){setError(String(error));}}
  return <article className="panel"><h2>Paired devices</h2><p>Pairing links expire in ten minutes and work once.</p><button onClick={()=>void action('/api/auth/pair','POST')}>Create pairing link</button>{link&&<p><a href={link}>{link}</a></p>}{devices.map(device=><p key={device.id}>{device.name} <button onClick={()=>{if(confirm('Revoke access for '+device.name+'?'))void action('/api/auth/devices/'+device.id,'DELETE');}}>Revoke</button></p>)}{error&&<p role="alert">{error}</p>}</article>;
}
