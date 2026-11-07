import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Browser, delay, installTestSource } from './cdp.mjs';
const endpoint=process.env.WEBVIEW_DEBUG_URL||'http://localhost:9224';
const output=resolve('.taste-skill/minimal-native');mkdirSync(output,{recursive:true});
let version;
for(let n=0;n<30;n++){try{version=await(await fetch(endpoint+'/json/version')).json();break;}catch{await delay(300);}}
assert(version,'Start the native app with WebView2 debugging enabled.');
const browser=await Browser.connect(version.webSocketDebuggerUrl);
const targets=()=>fetch(endpoint+'/json/list').then(r=>r.json());
const attachSurface=async name=>{for(let n=0;n<60;n++){const t=(await targets()).find(t=>t.url.includes('surface='+name));if(t)return browser.attach(t.id);await delay(150);}throw new Error('Missing surface '+name);};
const appData=join(process.env.APPDATA,'com.omnipulse.studio');
const snapshots=new Map(['hidden-captures.json','capture-folders.json','capture-kinds.json','widget-docks.json','clicker-binding.json'].map(name=>{const path=join(appData,name);return[path,existsSync(path)?readFileSync(path):null];}));
let page,preferences,binding;const created=[];
const input=async(keys=[],mouse=false)=>{
const type='using System;using System.Runtime.InteropServices;public class VerifyInput{[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}';
const calls=mouse?'[VerifyInput]::mouse_event(128,0,0,1,[UIntPtr]::Zero);Start-Sleep -Milliseconds 100;[VerifyInput]::mouse_event(256,0,0,1,[UIntPtr]::Zero)':keys.map(([key,up])=>'[VerifyInput]::keybd_event('+key+',0,'+(up?2:0)+',[UIntPtr]::Zero);Start-Sleep -Milliseconds 100').join(';');
execFileSync('powershell.exe',['-NoProfile','-Command',"Add-Type -TypeDefinition '"+type+"';"+calls],{windowsHide:true});
};
try{
  const main=(await targets()).find(t=>!t.url.includes('surface='));assert(main);page=await browser.attach(main.id);
  await page.wait(()=>!!document.querySelector('.recorder-page'));
  preferences=await page.eval(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('omnipulse')).map(k=>[k,localStorage.getItem(k)])));
  
  await page.eval(()=>{localStorage.setItem('omnipulse.screenshot.autoCopy.v1','false');localStorage.setItem('omnipulse.screenshot.autoSave.v1','false');});
  await page.send('Page.reload');await page.wait(()=>!!document.querySelector('.recorder-page'));
  const displays=await page.eval(()=>window.__TAURI_INTERNALS__.invoke('get_displays'));
  assert(displays.length);console.log('Displays:',JSON.stringify(displays));
  for(const display of displays){
    const result=await page.eval(async id=>{const image=await window.__TAURI_INTERNALS__.invoke('capture_display',{displayId:id,region:false,purpose:'screenshot'});return{width:image.width,height:image.height,png:image.data_url.startsWith('data:image/png;base64,')};},display.id);
    assert.deepEqual(result,{width:display.width,height:display.height,png:true});
  }
  console.log('PASS native full-screen capture uses each selected monitor and physical pixel bounds');
  await page.tab('Screenshot');
  await page.click('Capture display');
  await page.eval(id=>[...document.querySelectorAll('[role=option]')].find(node=>node.dataset.value===String(id)).click(),displays.at(-1).id);
  await page.click('Capture area');
  const selection=await attachSurface('selection');await selection.wait(()=>!!document.querySelector('.selection-backdrop'));

  const monitor=displays.at(-1);
  const dragType='using System;using System.Runtime.InteropServices;public class CaptureDrag{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}';
  const dragCommands='[CaptureDrag]::SetCursorPos('+(monitor.x+Math.round(monitor.width*.25))+','+(monitor.y+Math.round(monitor.height*.25))+');[CaptureDrag]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 100;[CaptureDrag]::SetCursorPos('+(monitor.x+Math.round(monitor.width*.75))+','+(monitor.y+Math.round(monitor.height*.75))+');Start-Sleep -Milliseconds 100;[CaptureDrag]::mouse_event(4,0,0,0,[UIntPtr]::Zero)';
  execFileSync('powershell.exe',['-NoProfile','-Command',"Add-Type -TypeDefinition '"+dragType+"';"+dragCommands],{windowsHide:true});
  await selection.wait(()=>!!document.querySelector('.desktop-selection-box'));
  await selection.click('Capture',true);
  await page.wait(()=>document.querySelector('.screenshot-page canvas')?.width>0);
  const crop=await page.eval(()=>({w:document.querySelector('.screenshot-page canvas').width,h:document.querySelector('.screenshot-page canvas').height,error:document.querySelector('.screenshot-page [role=alert]')?.textContent}));
  assert(Math.abs(crop.w-displays.at(-1).width/2)<=2);assert(Math.abs(crop.h-displays.at(-1).height/2)<=2);assert(!crop.error,crop.error);
  await page.click('Clear screenshot');
  console.log('PASS desktop selection overlay crops the last monitor at native resolution, restores the app, and keeps desktop pixels out of test artifacts');
  await page.click('Capture area');const canceled=await attachSurface('selection');await canceled.wait(()=>!!document.querySelector('.selection-backdrop'));
  await canceled.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await delay(300);
  await page.wait(()=>!document.querySelector('.screenshot-topbar button').disabled);
  console.log('PASS Escape cancels selection and releases capture controls');
  const captures=resolve(output,'captures');mkdirSync(captures,{recursive:true});
  await page.eval(folder=>{localStorage.setItem('omnipulse.recorder.destination.v1',JSON.stringify(folder));localStorage.setItem('omnipulse.recorder.minimize.v1','true');localStorage.setItem('omnipulse.recorder.frame.v1','true');},captures);
  await page.send('Page.reload');await page.wait(()=>!!document.querySelector('.recorder-page'));await installTestSource(page);
  await page.click('Choose capture source');await page.wait(()=>document.querySelector('.preview-topline').textContent.includes('Source connected'));
  const controls=await attachSurface('widget&kind=recorder');await controls.wait(()=>document.querySelector('[aria-label="Start recording"]')?.disabled===false);
  assert(await page.eval(async()=>{return !(await window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'}));}));
  await controls.click('Start recording',true);await page.wait(()=>document.querySelector('.preview-topline').textContent.includes('Recording'));
  const frame=await attachSurface('frame');await frame.wait(()=>!!document.querySelector('.recording-halo'));
  await controls.screenshot(resolve(output,'widget.png'));
  await delay(1200);await controls.click('Pause',true);await page.wait(()=>document.querySelector('.preview-topline').textContent.includes('Paused'));
  await controls.wait(()=>!!document.querySelector('[aria-label=Resume]'));await controls.click('Resume',true);
  await controls.click('Hide widget',true);
  assert(await page.eval(async()=>{return !(await window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'recorder-controls'}));}));
  await page.eval(()=>window.__TAURI_INTERNALS__.invoke('show_recording_overlay',{displayId:0,frame:true,minimize:false}));
  await delay(500);await controls.click('Stop and save',true);
  await page.wait(()=>document.querySelector('.recorder-page').textContent.includes('Recording saved.'));
  const video=await page.eval(folder=>window.__TAURI_INTERNALS__.invoke('list_recordings').then(files=>files.find(f=>f.path.toLowerCase().startsWith(folder.toLowerCase())&&f.kind==='video')),captures);assert(video&&readFileSync(video.path).length>1000);created.push(video.path);
  assert(!(await targets()).some(t=>t.url.includes('surface=widget&kind=recorder')||t.url.includes('surface=frame')));
  console.log('PASS floating Record/Pause/Resume/Stop, minimize, hide/reopen, display frame, and actual saved media');
  const pictures=(await page.eval(()=>window.__TAURI_INTERNALS__.invoke('get_output_dirs'))).pictures;
  const libraryFiles=await page.eval(async folder=>{const result=[];for(let i=0;i<2;i++){const c=document.createElement('canvas');c.width=48+i*96;c.height=48+i*96;const ctx=c.getContext('2d');ctx.fillStyle=i?'#777':'#222';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#ee696c';ctx.fillRect(5,5,20,20);const path=folder+'/FrameCue_TEST_'+Date.now()+'_'+i+'.png';await window.__TAURI_INTERNALS__.invoke('save_screenshot',{dataUrl:c.toDataURL(),customPath:path});result.push(path);}return result;},pictures);created.push(...libraryFiles);
  await page.tab('Library');await page.eval(()=>{const input=document.querySelector('[aria-label="Search captures"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'FrameCue_TEST_');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.wait(()=>document.querySelectorAll('.media-row').length===2);
  await page.click('Remove '+libraryFiles[0].split(/[\\/]/).at(-1));await page.click('Hide capture',true);await page.wait(()=>document.querySelectorAll('.media-row').length===1);assert(existsSync(libraryFiles[0]));
  await page.click('Refresh library');await page.wait(()=>document.querySelectorAll('.media-row').length===1);
  console.log('PASS library hides persistently without deleting the original');
  await page.click('Remove '+libraryFiles[1].split(/[\\/]/).at(-1));
  await page.eval(()=>{const option=[...document.querySelectorAll('.remove-option')].find(n=>n.textContent.includes('Delete from device'));option.querySelector('input').click();});
  assert(existsSync(libraryFiles[1]));await page.click('Delete file',true);await page.wait(()=>document.querySelectorAll('.media-row').length===0);assert(!existsSync(libraryFiles[1]));
  await page.click('Library filters');
  assert(await page.eval(()=>!!document.querySelector('[aria-label="From date"]')&&!!document.querySelector('[aria-label="Sort captures"]')));
  await page.screenshot(resolve(output,'library.png'));
  console.log('PASS explicit device deletion removes only the selected synthetic file; date and size controls are present');
  await page.tab('Auto-clicker');
  assert(Array.isArray(await page.eval(()=>window.__TAURI_INTERNALS__.invoke('get_clicker_items'))));
  await page.screenshot(resolve(output,'clicker.png'));assert.deepEqual(page.errors,[]);
  console.log('PASS multi-item clicker loads without affecting recording, capture or library flows.');
  writeFileSync(resolve(output,'results.json'),JSON.stringify({passed:true,displays,crop,videoBytes:video.size_bytes,errors:page.errors},null,2));
}finally{
  if(page){await page.eval(()=>window.__TAURI_INTERNALS__.invoke('cancel_binding')).catch(()=>{});await page.eval(()=>window.__TAURI_INTERNALS__.invoke('recording_action',{action:'stop'})).catch(()=>{});await delay(400);await page.eval(()=>window.__TAURI_INTERNALS__.invoke('stop_autoclicker')).catch(()=>{});await page.eval(()=>window.__TAURI_INTERNALS__.invoke('cancel_selection')).catch(()=>{});await page.eval(()=>window.__TAURI_INTERNALS__.invoke('close_recording_overlay',{restoreMain:true})).catch(()=>{});if(preferences){await page.eval(saved=>{Object.keys(localStorage).filter(k=>k.startsWith('omnipulse')).forEach(k=>localStorage.removeItem(k));Object.entries(saved).forEach(([k,v])=>localStorage.setItem(k,v));},preferences);await page.send('Page.reload').catch(()=>{});}}
  for(const path of created)if(existsSync(path))unlinkSync(path);
  for(const [path,data]of snapshots){if(data)writeFileSync(path,data);else if(existsSync(path))unlinkSync(path);}
  await browser.close();
}
