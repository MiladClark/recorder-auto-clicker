import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Browser,delay,installTestSource} from './cdp.mjs';
const out=resolve('.taste-skill/native-060'),media=join(out,'media');mkdirSync(media,{recursive:true});
const endpoint='http://localhost:9224';let version;
for(let i=0;i<40;i++){try{version=await(await fetch(endpoint+'/json/version')).json();break;}catch{await delay(200);}}
assert(version);const browser=await Browser.connect(version.webSocketDebuggerUrl);
const targets=()=>fetch(endpoint+'/json/list').then(result=>result.json());
const attach=async kind=>{for(let i=0;i<50;i++){const target=(await targets()).find(target=>target.url.includes('surface=widget')&&target.url.includes('kind='+kind));if(target)return browser.attach(target.id);await delay(100);}throw Error('Missing widget '+kind);};
const appData=join(process.env.APPDATA,'com.omnipulse.studio');
const snapshots=new Map(['capture-folders.json','capture-kinds.json','hidden-captures.json','widget-docks.json'].map(name=>{const path=join(appData,name);return[path,existsSync(path)?readFileSync(path):null];}));
const cursor=(point)=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','tests/widget-pointer.ps1',...(point?['-Move','-X',String(point.x),'-Y',String(point.y)]:[])],{encoding:'utf8',windowsHide:true}));
let page,preferences,clipboard,originalCursor;const created=[],docks=[];
try{
 page=await browser.attach((await targets()).find(target=>!target.url.includes('surface=')).id);
 await page.wait(()=>!!document.querySelector('.page h1')&&!document.querySelector('.devtune-splash'));
 preferences=await page.eval(()=>Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)])));
 writeFileSync(join(out,'preferences-before-test.json'),JSON.stringify(preferences));
 await page.eval(folder=>{
  localStorage.setItem('omnipulse.recorder.destination.v1',JSON.stringify(folder));localStorage.setItem('omnipulse.voice.destination.v1',JSON.stringify(folder));
  localStorage.setItem('omnipulse.recorder.minimize.v1','false');localStorage.setItem('omnipulse.recorder.frame.v1','false');localStorage.setItem('omnipulse.recorder.mic.v1','false');
  localStorage.setItem('omnipulse.screenshot.autoCopy.v1','true');localStorage.setItem('omnipulse.screenshot.autoSave.v1','false');
 },media);
 await page.send('Page.reload');await page.wait(()=>!!document.querySelector('.page h1')&&!document.querySelector('.devtune-splash'));
 clipboard=spawn('powershell.exe',['-NoProfile','-STA','-File','tests/clipboard-preserve.ps1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 await new Promise((resolve,reject)=>{let text='';clipboard.stdout.on('data',data=>{text+=data;if(text.includes('READY'))resolve();});clipboard.on('error',reject);setTimeout(()=>reject(Error('Clipboard backup timeout')),10000).unref();});
 await page.tab('Screenshot');
 await page.eval(async()=>{
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle='#19a278';context.fillRect(0,0,96,64);
  await window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'capture:result',payload:{data_url:canvas.toDataURL('image/png'),width:96,height:64}});
 });
 await page.wait(()=>document.querySelector('.screenshot-page [role=status]')?.textContent.includes('Copied'));
 assert.equal(await page.eval(()=>document.querySelector('.screenshot-page [role=alert]')?.textContent),undefined);
 const clipboardSize=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-STA','-Command',"Add-Type -AssemblyName System.Windows.Forms; $taskImage=[System.Windows.Forms.Clipboard]::GetImage(); if($null -eq $taskImage){throw 'No image'}; @{width=$taskImage.Width;height=$taskImage.Height}|ConvertTo-Json -Compress; $taskImage.Dispose()"],{encoding:'utf8',windowsHide:true}));
 assert.deepEqual(clipboardSize,{width:96,height:64});
 console.log('PASS PNG screenshot copies into the Windows clipboard without technical errors.');
 const tray=await page.eval(()=>window.__TAURI_INTERNALS__.invoke('get_tray_state'));assert(tray.present);
 await page.eval(()=>window.__TAURI_INTERNALS__.invoke('minimize_to_tray'));
 assert.equal(await page.eval(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})),false);
 await page.eval(()=>window.__TAURI_INTERNALS__.invoke('tray_action',{action:'voice'}));
 await page.wait(()=>!document.querySelector('.voice-page').parentElement.hidden);
 assert(await page.eval(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})));
 await page.eval(()=>{
  navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();oscillator.frequency.value=330;gain.gain.value=.15;oscillator.connect(gain).connect(destination);oscillator.start();window.nativeVoice={context,oscillator,stream:destination.stream};return destination.stream;};
 });
 await page.click('Record voice');await page.wait(()=>document.querySelector('.voice-topline').textContent.includes('Listening'));
 await installTestSource(page);await page.tab('Recorder');await page.click('Choose capture source');await page.wait(()=>!document.querySelector('.transport .button.primary').disabled);await page.click('Start recording');
 await page.wait(async()=>{const tray=await window.__TAURI_INTERNALS__.invoke('get_tray_state');return tray.state.screen&&tray.state.voice;});
 console.log('PASS tray visibility/navigation and concurrent independent screen + voice recording.');
 originalCursor=cursor();
 for(const kind of ['recorder','voice','screenshot']){
  await page.eval(kind=>window.__TAURI_INTERNALS__.invoke('show_widget',{kind,displayId:0,minimize:false}),kind);
  const widget=await attach(kind);await widget.wait(()=>!!document.querySelector('.dock-widget'));
  for(const edge of ['left','right','top']){
   await page.eval(({kind,edge})=>window.__TAURI_INTERNALS__.invoke('dock_widget',{kind,edge,reducedMotion:false}),{kind,edge});
   const rect=await page.eval(async kind=>{const label=kind==='recorder'?'recorder-controls':kind+'-controls';return{position:await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position',{label}),size:await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_size',{label}),dock:(await window.__TAURI_INTERNALS__.invoke('get_widget_state',{kind})).dock};},kind);
   assert.equal(rect.dock.edge,edge);assert.equal(rect.size.width>rect.size.height,edge==='top');
   assert(await widget.eval(()=>[...document.querySelectorAll('button')].every(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;})));
   await widget.screenshot(join(out,`${kind}-${edge}.png`));docks.push({kind,edge,...rect});
  }
  await page.eval(kind=>window.__TAURI_INTERNALS__.invoke('begin_widget_drag',{kind}),kind);
  cursor({x:originalCursor.x+180,y:originalCursor.y+180});
  await page.eval(kind=>window.__TAURI_INTERNALS__.invoke('drag_widget',{kind}),kind);
  const dock=await page.eval(kind=>window.__TAURI_INTERNALS__.invoke('dock_widget',{kind,edge:null,reducedMotion:true}),kind);
  assert(['top','left','right'].includes(dock.edge));cursor(originalCursor);
  assert(!await widget.eval(()=>!!document.querySelector('.devtune-splash')),'Widgets must not show the launch splash');
 }
 console.log('PASS all three widgets dock horizontally at top, vertically at left/right, remain within bounds and snap back after a free drag.');
 await page.eval(()=>window.__TAURI_INTERNALS__.invoke('tray_action',{action:'voice-pause'}));
 await page.wait(()=>document.querySelector('.voice-topline').textContent.includes('Paused'));
 const frozen=await page.eval(()=>document.querySelector('.voice-transport .timer').textContent);await delay(1100);assert.equal(await page.eval(()=>document.querySelector('.voice-transport .timer').textContent),frozen);
 await page.eval(()=>window.__TAURI_INTERNALS__.invoke('tray_action',{action:'voice-pause'}));await delay(300);
 await page.eval(()=>window.__TAURI_INTERNALS__.invoke('tray_action',{action:'voice-stop'}));
 await page.wait(()=>!!document.querySelector('.voice-playback audio'));
 await page.eval(()=>window.__TAURI_INTERNALS__.invoke('tray_action',{action:'screen-stop'}));
 await page.wait(()=>document.querySelector('.recorder-page').textContent.includes('Recording saved.'));
 const files=await page.eval(folder=>window.__TAURI_INTERNALS__.invoke('list_recordings').then(files=>files.filter(file=>file.path.toLowerCase().startsWith(folder.toLowerCase()))),media);
 created.push(...files.map(file=>file.path));assert(files.some(file=>file.kind==='audio'));assert(files.some(file=>file.kind==='video'));
 for(const file of files){assert(readFileSync(file.path).length>1000);}
 await page.tab('Voice Recorder');await page.eval(()=>{const audio=document.querySelector('.voice-playback audio');audio.muted=true;return audio.play();});assert.equal(await page.eval(()=>document.querySelector('.voice-playback audio').error),null);
 await page.tab('Library');await page.click('Audio');assert(await page.eval(()=>[...document.querySelectorAll('.media-description span')].every(node=>node.textContent.includes('Audio'))));
 await page.tab('Auto-clicker');await page.eval(()=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'autoclicker:error',payload:'from_bytes Cargo image-png backend failure'}));
 await page.wait(()=>!!document.querySelector('.clicker-page [role=alert]'));assert(!await page.eval(()=>document.querySelector('.clicker-page [role=alert]').textContent.includes('Cargo')));
 await page.eval(()=>{window.nativeVoice.oscillator.stop();return window.nativeVoice.context.close();});
 assert.deepEqual(page.errors,[]);
 writeFileSync(join(out,'review.json'),JSON.stringify({passed:true,clipboardSize,trayPresent:true,concurrentMedia:files.map(file=>({kind:file.kind,size:file.size_bytes})),docks,pauseResume:true,audioPlayback:true,errorSanitization:true,errors:page.errors},null,2));
 console.log('PASS tray pause/resume/stop, real audio/video files, audio library, playback and sanitized error feedback.');
}finally{
 if(page){
  await page.eval(()=>window.__TAURI_INTERNALS__.invoke('recording_action',{action:'stop'})).catch(()=>{});
  await page.eval(()=>window.__TAURI_INTERNALS__.invoke('widget_action',{kind:'voice',action:'stop'})).catch(()=>{});await delay(400);
  for(const kind of ['recorder','voice','screenshot'])await page.eval(kind=>window.__TAURI_INTERNALS__.invoke('close_widget',{kind}),kind).catch(()=>{});
  if(preferences){await page.eval(saved=>{localStorage.clear();Object.entries(saved).forEach(([key,value])=>localStorage.setItem(key,value));},preferences);await page.send('Page.reload').catch(()=>{});}
 }
 if(originalCursor)cursor(originalCursor);
 if(clipboard){clipboard.stdin.end('restore\n');await new Promise(resolve=>{clipboard.on('exit',resolve);setTimeout(resolve,3000).unref();});}
 for(const path of created)if(existsSync(path))unlinkSync(path);
 for(const[path,bytes]of snapshots){if(bytes)writeFileSync(path,bytes);else if(existsSync(path))unlinkSync(path);}
 await browser.close();
}
