import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',workers:1,timeout:Number(process.env.E2E_TIMEOUT_MS??90000),expect:{timeout:15000},outputDir:'work/playwright-results',
  reporter:'list',use:{baseURL:'https://127.0.0.1:3490',ignoreHTTPSErrors:true,screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[{name:'android-phone',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'tablet',use:{browserName:'chromium',viewport:{width:1024,height:768},hasTouch:true}}],
  webServer:{command:'node scripts/e2e-server.mjs',url:'https://127.0.0.1:3490/api/health',ignoreHTTPSErrors:true,timeout:30000,reuseExistingServer:false},
});
