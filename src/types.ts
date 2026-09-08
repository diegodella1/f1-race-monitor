export type * from '../server/types';
export type {ConnectionStatus as Status,DriverState as Driver,RaceAlert as Alert} from '../server/types';
export interface AppInfo {settings:import('../server/types').Settings;ips:string[];mobileUrl:string;qr:string}
