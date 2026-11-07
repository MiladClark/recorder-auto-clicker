import assert from 'node:assert/strict';
import{execFileSync}from'node:child_process';
import{existsSync,readFileSync,writeFileSync,unlinkSync}from'node:fs';
import{resolve,join}from'node:path';
import{Browser,delay}from'./cdp.mjs';
const endpoint=process.env.WEBVIEW_DEBUG_URL||'http://localhost:9224';
const executable=resolve('FrameCue.exe'),release=resolve('release/FrameCue-0.5.0.exe');
const dataPath=join(process.env.APPDATA,'com.omnipulse.studio/clicker-items.json');
const snapshot=existsSync(dataPath)?readFileSync(dataPath):null;
let browser,page,original=[];
const connect=async()=>{for(let i=0;i<40;i++){try{const v=await(await fetch(endpoint+'/json/version')).json();browser=await Browser.connect(v.webSocketDebuggerUrl);const targets=await(await fetch(endpoint+'/json/list')).json();const target=targets.find(t=>!t.url.includes('surface='));if(target){page=await browser.attach(target.id);await page.wait(()=>!!document.querySelector('.recorder-page'));return;}}catch{}await delay(250);}throw new Error('App did not restart.');};
const invoke=(name,args={})=>page.eval(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const binding=vk=>({vk,ctrl:false,shift:false,alt:false,win:false,label:'F'+(vk-111)});
try{
 await connect();await invoke('stop_autoclicker',{id:null});original=await invoke('get_clicker_items');
 for(const item of original)await invoke('delete_clicker_item',{id:item.id});
 const fixtures=[{id:'persistence-clear',action:binding(134),mode:'repeat',interval_ms:.5,trigger:null},{id:'persistence-hold',action:binding(133),mode:'hold',interval_ms:100,trigger:binding(135)}];
 for(const item of fixtures)await invoke('save_clicker_item',{item});
 await browser.close();
 execFileSync('powershell.exe',['-NoProfile','-File',resolve('scripts/close-app.ps1'),'-Launcher',executable,'-Release',release],{windowsHide:true});
 execFileSync('powershell.exe',['-NoProfile','-File',resolve('tests/restart-app.ps1'),'-Executable',executable],{windowsHide:true});
 await connect();assert.deepEqual(await invoke('get_clicker_items'),fixtures);
 await page.tab('Auto-clicker');assert.equal(await page.eval(()=>document.querySelectorAll('.clicker-item').length),2);
 assert.match(await page.eval(()=>document.querySelector('.clicker-items').textContent),/0.5 ms/);
 assert.match(await page.eval(()=>document.querySelector('.clicker-items').textContent),/No shortcut/);
 console.log('PASS saved items, fractional delay, Hold mode and a cleared shortcut survive a full application restart.');
}finally{
 if(page){for(const item of await invoke('get_clicker_items').catch(()=>[]))await invoke('delete_clicker_item',{id:item.id}).catch(()=>{});for(const item of original)await invoke('save_clicker_item',{item}).catch(()=>{});if(snapshot)writeFileSync(dataPath,snapshot);else if(existsSync(dataPath))unlinkSync(dataPath);await page.send('Page.reload').catch(()=>{});}
 if(browser)await browser.close();
}
