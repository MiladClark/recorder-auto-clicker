import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Browser,delay} from './cdp.mjs';
const endpoint=process.env.WEBVIEW_DEBUG_URL||'http://localhost:9224';
const output=resolve('.taste-skill/clicker-native');mkdirSync(output,{recursive:true});
const dataPath=join(process.env.APPDATA,'com.omnipulse.studio','clicker-items.json');
const diskBefore=existsSync(dataPath)?readFileSync(dataPath):null;
const input=(operation,code=0,x=0,y=0)=>execFileSync('powershell.exe',['-NoProfile','-File',resolve('tests/windows-input.ps1'),'-Operation',operation,'-Code',String(code),'-X',String(x),'-Y',String(y)],{windowsHide:true,encoding:'utf8'}).trim();
const cursor=JSON.parse(input('cursor'));
const version=await(await fetch(endpoint+'/json/version')).json();
const browser=await Browser.connect(version.webSocketDebuggerUrl);
let page,original=[];
const invoke=(name,args={})=>page.eval(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const status=async id=>(await invoke('get_autoclicker_status')).find(item=>item.id===id)||{running:false,clicks:0};
const waitStatus=async(id,running)=>{for(let n=0;n<60;n++){if((await status(id)).running===running)return;await delay(50);}throw new Error('Status did not become '+running+' for '+id);};
const learn=async(target,type,code)=>{await page.click(target==='output'?'Choose action button':'Set start/stop shortcut');await page.wait(()=>!!document.querySelector('.binding-prompt'));input(type,code);await page.wait(()=>!document.querySelector('.binding-prompt'));};
const save=async()=>{await page.click('Save item');await page.wait(()=>!document.querySelector('.clicker-editor')||!!document.querySelector('.clicker-page [role=alert]'));assert(!await page.eval(()=>document.querySelector('.clicker-page [role=alert]')?.textContent),await page.eval(()=>document.querySelector('.clicker-page [role=alert]')?.textContent));};
const setDelay=async value=>page.eval(value=>{const node=document.querySelector('#clicker-delay');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
try{
 const targets=await(await fetch(endpoint+'/json/list')).json();page=await browser.attach(targets.find(target=>!target.url.includes('surface=')).id);
 await page.wait(()=>!!document.querySelector('.recorder-page'));await page.tab('Auto-clicker');
 original=await invoke('get_clicker_items');await invoke('stop_autoclicker',{id:null});
 for(const item of original)await invoke('delete_clicker_item',{id:item.id});
 await page.wait(()=>document.querySelector('.clicker-items').textContent.includes('No items'));
 input('focus');
 const blank=await page.eval(()=>({x:screenX+innerWidth/2,y:screenY+innerHeight-65}));input('move',0,blank.x,blank.y);
 await page.click('Add item');await learn('output','mouse',1);
 assert.match(await page.eval(()=>document.querySelector('.output-binding').textContent),/Mouse left/);
 await setDelay(.5);await save();
 await page.click('Add item');await learn('output','key',75);await learn('trigger','key',118);await setDelay(25);await save();
 await page.click('Add item');await learn('output','key',79);await learn('trigger','mouse',6);await page.click('Action mode');await page.eval(()=>document.querySelector('[role=option][data-value=hold]').click());await save();
 const [left,k,o]=await invoke('get_clicker_items');
 assert.equal(left.interval_ms,.5);assert.equal(left.trigger.vk,117);assert.equal(k.action.vk,75);assert.equal(k.trigger.vk,118);assert.equal(o.trigger.vk,6);assert.equal(o.mode,'hold');
 assert.equal(JSON.parse(readFileSync(dataPath,'utf8')).length,3);
 await page.click('Edit Mouse left');await learn('trigger','key',117);await save();
 assert.equal((await status(left.id)).running,false);
 await page.screenshot(resolve(output,'items.png'));
 console.log('PASS native capture of left mouse, K, O and a side mouse shortcut; each item persists separately.');
 // Observe delivered events in the real WebView, not only the worker counter.
 await page.eval(()=>{document.activeElement?.blur();window.__clickerProbe={mouse:0,k:0};window.addEventListener('pointerdown',()=>window.__clickerProbe.mouse++);window.addEventListener('keydown',event=>{if(event.keyCode===75)window.__clickerProbe.k++;});});
 input('move',0,blank.x,blank.y);input('key',117);await waitStatus(left.id,true);
 input('key',118);await waitStatus(k.id,true);
 input('mouse',6);await waitStatus(o.id,true);
 await delay(180);
 assert.equal((await invoke('get_autoclicker_status')).filter(item=>item.running).length,3);
 assert.equal(input('pressed',79),'true');
 assert((await status(left.id)).clicks>25);
 const delivered=await page.eval(()=>window.__clickerProbe);assert(delivered.mouse>5&&delivered.k>2,JSON.stringify({delivered,items:[left,k,o],statuses:await invoke('get_autoclicker_status'),focused:await page.eval(()=>({focus:document.hasFocus(),active:document.activeElement.tagName}))}));
 await page.screenshot(resolve(output,'running.png'));
 input('key',117);await waitStatus(left.id,false);assert((await status(k.id)).running&&(await status(o.id)).running);
 input('key',118);await waitStatus(k.id,false);assert((await status(o.id)).running);
 input('mouse',6);await waitStatus(o.id,false);assert.equal(input('pressed',79),'false');
 console.log('PASS 3 concurrent workers deliver real mouse/keyboard events; each shortcut stops only its item; Hold releases its key.');
 // A held modifier must not prevent the same shortcut from stopping the item.
 await page.click('Edit '+o.action.label);await learn('output','key',17);await learn('trigger','key',119);await save();
 assert.equal((await invoke('get_clicker_items')).find(item=>item.id===o.id).action.vk,17);
 input('key',119);await waitStatus(o.id,true);assert.equal(input('pressed',17),'true');
 input('key',119);await waitStatus(o.id,false);assert.equal(input('pressed',17),'false');
 console.log('PASS standalone modifier capture/output and stopping Hold while a modifier is held.');
 await invoke('save_clicker_item',{item:{...o,action:{vk:134,ctrl:false,alt:false,shift:false,win:false,label:'F23'},mode:'repeat',interval_ms:30,trigger:{vk:17,ctrl:false,alt:false,shift:false,win:false,label:'Ctrl'}}});
 input('key',17);await waitStatus(o.id,true);input('key',17);await waitStatus(o.id,false);
 console.log('PASS a standalone Ctrl key can also start/stop its own item globally.');
 // Restore O, clear only its shortcut in the UI, and verify the previous key cannot start it.
 await invoke('save_clicker_item',{item:{...o,trigger:{vk:119,ctrl:false,alt:false,shift:false,win:false,label:'F8'}}});
 await page.click('Edit '+o.action.label);await page.click('Clear start/stop shortcut');await save();
 assert.equal((await invoke('get_clicker_items')).find(item=>item.id===o.id).trigger,null);
 input('key',119);await delay(120);assert.equal((await status(o.id)).running,false);
 await page.click('Start '+o.action.label);await waitStatus(o.id,true);await page.click('Stop '+o.action.label);await waitStatus(o.id,false);
 assert.equal(input('pressed',79),'false');
 await page.click('Edit '+k.action.label);await page.click('Clear action button');await save();
 input('key',118);await delay(100);assert.equal((await status(k.id)).running,false);
 assert(await page.eval(()=>document.querySelector('[aria-label="Start item"]').disabled));
 console.log('PASS Clear disables the selected shortcut/output; manual Start still works with no shortcut.');
 const current=await invoke('get_clicker_items');
 const rejected=async item=>page.eval(async item=>{try{await window.__TAURI_INTERNALS__.invoke('save_clicker_item',{item});return '';}catch(error){return String(error);}},item);
 assert.match(await rejected({...current[2],trigger:{...left.trigger}}),/already assigned/);
 assert.match(await rejected({...current[2],action:{...left.trigger},trigger:null}),/different start\/stop/);
 assert.deepEqual(await invoke('get_clicker_items'),current);
 // Stop-all must release every held button as well as repeat workers.
 await invoke('start_autoclicker',{id:left.id});await invoke('start_autoclicker',{id:o.id});await waitStatus(o.id,true);
 await page.click('Stop all');await waitStatus(left.id,false);await waitStatus(o.id,false);assert.equal(input('pressed',79),'false');
 await page.click('Start Mouse left');await page.wait(()=>document.querySelector('.clicker-items').textContent.includes('Starting in'));
 input('stopall');await delay(2200);assert.equal((await status(left.id)).running,false);assert(!await page.eval(()=>document.querySelector('.clicker-items').textContent.includes('Starting in')));
 await page.click('Start Mouse left');input('key',117);await waitStatus(left.id,true);input('key',117);await waitStatus(left.id,false);await delay(2200);assert.equal((await status(left.id)).running,false);
 console.log('PASS emergency stop cancels pending mouse starts; using a shortcut during the countdown cannot restart a stopped item.');
 // Time actual Windows down/up events, not just the worker's click counter.
 input('focus');
 await page.eval(()=>{
  document.activeElement?.blur();window.__timingEvents=[];
  for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
   if(['F23','F24'].includes(event.key)&&!event.repeat)window.__timingEvents.push({key:event.key,type,time:performance.now()});
  });
 });
 const timed={...o,id:'timing-test',action:{vk:134,ctrl:false,alt:false,shift:false,win:false,label:'F23'},trigger:null,mode:'cycle',hold_ms:240,pause_ms:320,burst_ms:220,interval_ms:40};
 await invoke('save_clicker_item',{item:timed});
 await page.eval(()=>{window.__timingEvents=[];});await invoke('start_autoclicker',{id:timed.id});await delay(1400);await invoke('stop_autoclicker',{id:timed.id});
 const cycle=await page.eval(()=>window.__timingEvents);
 assert(cycle.filter(event=>event.type==='keydown').length>=3,JSON.stringify(cycle));
 for(let n=0;n+2<cycle.length;n+=2){
  assert.equal(cycle[n].type,'keydown');assert.equal(cycle[n+1].type,'keyup');
  const held=cycle[n+1].time-cycle[n].time,gap=cycle[n+2].time-cycle[n+1].time;
  assert(held>=190&&held<400,'Hold duration '+held);assert(gap>=270&&gap<480,'Released pause '+gap);
 }
 assert.equal(cycle.at(-1).type,'keyup');
 await invoke('save_clicker_item',{item:{...timed,mode:'burst'}});
 await page.eval(()=>{window.__timingEvents=[];});await invoke('start_autoclicker',{id:timed.id});await delay(1300);await invoke('stop_autoclicker',{id:timed.id});
 const burst=await page.eval(()=>window.__timingEvents);
 const downs=burst.filter(event=>event.type==='keydown');const gaps=downs.slice(1).map((event,index)=>event.time-downs[index].time);
 assert(downs.length>=12&&downs.length<24,'Burst clicks '+downs.length);
 assert(gaps.filter(gap=>gap>=300).length>=2,JSON.stringify(gaps));
 assert(gaps.filter(gap=>gap>=28&&gap<100).length>=8,JSON.stringify(gaps));
 assert.equal(burst.filter(event=>event.type==='keydown').length,burst.filter(event=>event.type==='keyup').length);
 console.log('PASS timed hold/release cycles and click bursts deliver real events with distinct no-click pauses.');
 // A ten-second hold or pause must remain immediately interruptible.
 const phase=async wanted=>{for(let n=0;n<100;n++){if((await status(timed.id)).phase===wanted)return;await delay(15);}throw new Error('Missing timing phase '+wanted);};
 await invoke('save_clicker_item',{item:{...timed,hold_ms:10000,pause_ms:10000}});
 await invoke('start_autoclicker',{id:timed.id});await phase('holding');
 let stopAt=performance.now();await invoke('stop_autoclicker',{id:timed.id});assert(performance.now()-stopAt<400,'Stop was blocked by hold');assert.equal(input('pressed',134),'false');
 await invoke('save_clicker_item',{item:{...timed,hold_ms:120,pause_ms:10000}});
 await page.eval(()=>{window.__timingEvents=[];});await invoke('start_autoclicker',{id:timed.id});await phase('resting');
 const restingCount=(await status(timed.id)).clicks;await delay(180);assert.equal((await status(timed.id)).clicks,restingCount);
 await page.wait(()=>document.querySelector('[data-item-id="timing-test"]').textContent.includes('Paused'));
 stopAt=performance.now();await invoke('stop_autoclicker',{id:timed.id});assert(performance.now()-stopAt<400,'Stop was blocked by pause');
 const afterStop=(await page.eval(()=>window.__timingEvents)).length;await delay(180);assert.equal((await page.eval(()=>window.__timingEvents)).length,afterStop);
 await invoke('save_clicker_item',{item:{...timed,hold_ms:10000,pause_ms:10000}});await invoke('start_autoclicker',{id:timed.id});await phase('holding');
 input('stopall');await waitStatus(timed.id,false);assert.equal(input('pressed',134),'false');
 await invoke('save_clicker_item',{item:{...timed,mode:'burst',burst_ms:120,pause_ms:10000}});await invoke('start_autoclicker',{id:timed.id});await phase('resting');
 stopAt=performance.now();await invoke('stop_autoclicker',{id:timed.id});assert(performance.now()-stopAt<400,'Stop was blocked by burst pause');
 await invoke('delete_clicker_item',{id:timed.id});
 writeFileSync(resolve(output,'timing-events.json'),JSON.stringify({cycle,burst,gaps},null,2));
 console.log('PASS immediate Stop during long holds and pauses, released keys, correct Paused status and emergency stop of timed holds.');
 await page.click('Delete Mouse left');assert.equal((await invoke('get_clicker_items')).length,2);
 assert.deepEqual(page.errors,[]);
 await page.screenshot(resolve(output,'cleared.png'));
 writeFileSync(resolve(output,'results.json'),JSON.stringify({passed:true,items:3,realEvents:delivered,fractionalDelayMs:left.interval_ms,independentStops:true,holdRelease:true,modifierStop:true,clearDisables:true,conflictChecks:true,stopAll:true,errors:page.errors},null,2));
 console.log('PASS duplicate/cross-trigger protection, stop-all, deletion and no uncaught native WebView exceptions.');
}finally{
 if(page){
  await invoke('cancel_binding').catch(()=>{});await invoke('stop_autoclicker',{id:null}).catch(()=>{});
  for(const item of await invoke('get_clicker_items').catch(()=>[]))await invoke('delete_clicker_item',{id:item.id}).catch(()=>{});
  for(const item of original)await invoke('save_clicker_item',{item}).catch(()=>{});
  if(diskBefore)writeFileSync(dataPath,diskBefore);else if(existsSync(dataPath))unlinkSync(dataPath);
  await page.send('Page.reload').catch(()=>{});
 }
 for(const code of[17,79,134,135])input('up',code);input('move',0,cursor.x,cursor.y);
 await browser.close();
}
