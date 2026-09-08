import { DeviceAuth } from './auth.js';
const auth=new DeviceAuth('data/devices.sqlite');
const origin=process.env.APP_ORIGIN??'https://f12025.diegodella.ar';
console.log(`${origin}/#pair=${auth.pair()}`);
auth.close();
