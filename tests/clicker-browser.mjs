import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Browser,delay} from './cdp.mjs';
const output=resolve('.taste-skill/clicker');mkdirSync(output,{recursive:true});
const browser=await Browser.launch();
const setValue=async(page,selector,value)=>{
 if(await page.eval(selector=>document.querySelector(selector)?.getAttribute('role')==='combobox',selector)){
  await page.eval(selector=>document.querySelector(selector).click(),selector);
  await page.eval(value=>[...document.querySelectorAll('[role=option]')].find(node=>node.dataset.value===value).click(),value);
 }else await page.eval(({selector,value})=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));},{selector,value});
};
const key=async(page,label,vk)=>{await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:label,code:label.length===1?'Key'+label:label,windowsVirtualKeyCode:vk});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:label,code:label.length===1?'Key'+label:label,windowsVirtualKeyCode:vk});await delay(80);};
try{
 const page=await browser.newPage(process.env.TEST_URL||'http://127.0.0.1:1420',960,700);
 await page.tab('Auto-clicker');await page.click('Add item');
 assert.equal(await page.eval(()=>document.querySelector('.trigger-binding').textContent),'F6');
 await page.click('Choose action button');
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:480,y:400,button:'left',clickCount:1});
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:480,y:400,button:'left',clickCount:1});
 await page.wait(()=>document.querySelector('.output-binding')?.textContent==='Mouse left');
 await setValue(page,'#clicker-delay','0.5');await page.click('Save item');
 assert.match(await page.eval(()=>document.querySelector('.clicker-item').textContent),/Repeat · 0.5 ms/);
 for(const [label,vk,trigger,tvk]of[['K',75,'F7',118],['O',79,'F8',119]]){
  await page.click('Add item');await page.click('Choose action button');await key(page,label,vk);
  await page.click('Set start/stop shortcut');await key(page,trigger,tvk);
  if(label==='O'){await setValue(page,'[aria-label="Action mode"]','hold');assert(!await page.eval(()=>!!document.querySelector('#clicker-delay')));}
  else{await setValue(page,'#clicker-delay','1000');await setValue(page,'[aria-label="Delay unit"]','s');assert.equal(await page.eval(()=>document.querySelector('#clicker-delay').value),'1');}
  await page.click('Save item');
 }
 assert.equal(await page.eval(()=>document.querySelectorAll('.clicker-item').length),3);
 await page.screenshot(resolve(output,'items-960.png'));
 await page.click('Edit K');await page.click('Clear start/stop shortcut');
 assert.match(await page.eval(()=>document.querySelector('.clicker-editor').textContent),/Shortcut disabled/);
 await page.click('Save item');await page.send('Page.reload');await page.wait(()=>!!document.querySelector('.recorder-page')&&!document.querySelector('.devtune-splash'));await page.tab('Auto-clicker');
 const saved=await page.eval(()=>JSON.parse(localStorage.getItem('framecue.clicker.items.v1')));
 assert.equal(saved.length,3);assert.equal(saved[1].trigger,null);assert.equal(saved[2].mode,'hold');assert.equal(saved[0].interval_ms,0.5);
 await page.click('Start K');assert.match(await page.eval(()=>document.querySelector('[role=alert]').textContent),/Windows app/);await page.click('Dismiss',true).catch(()=>{});
 await page.click('Edit K');await setValue(page,'[aria-label="Action mode"]','cycle');
 assert(!await page.eval(()=>!!document.querySelector('#clicker-delay')));
 await setValue(page,'#clicker-hold','2');await setValue(page,'#clicker-pause','3');
 assert.equal(await page.eval(()=>document.querySelector('.click-pattern-preview').getAttribute('aria-label')),'Hold 2 s → Pause 3 s → Repeat');
 assert.equal(await page.eval(()=>document.querySelector('.click-pattern-cursor').getAnimations()[0].effect.getTiming().duration),5000);
 await setValue(page,'[aria-label="Hold for unit"]','ms');assert.equal(await page.eval(()=>document.querySelector('#clicker-hold').value),'2000');
 await setValue(page,'#clicker-pause','');await page.click('Save item');assert.match(await page.eval(()=>document.querySelector('.clicker-page [role=alert]').textContent),/Pause time must/);
 await setValue(page,'#clicker-pause','3');await page.click('Save item');
 await page.click('Edit O');await setValue(page,'[aria-label="Action mode"]','burst');
 await setValue(page,'#clicker-delay','25');await setValue(page,'#clicker-burst','0.5');await setValue(page,'#clicker-pause','0.4');
 assert(await page.eval(()=>document.querySelector('.clicker-editor-footer').getBoundingClientRect().bottom<=innerHeight),'Burst settings should fit the default window');
 await page.screenshot(resolve(output,'burst-960.png'));await page.eval(()=>document.documentElement.dataset.theme='light');await delay(300);await page.screenshot(resolve(output,'burst-light-960.png'));await page.eval(()=>document.documentElement.dataset.theme='dark');await page.click('Save item');
 await page.send('Page.reload');await page.wait(()=>!!document.querySelector('.recorder-page')&&!document.querySelector('.devtune-splash'));await page.tab('Auto-clicker');
 const timed=await page.eval(()=>JSON.parse(localStorage.getItem('framecue.clicker.items.v1')));
 assert.equal(timed[1].mode,'cycle');assert.equal(timed[1].hold_ms,2000);assert.equal(timed[1].pause_ms,3000);assert.equal(timed[1].interval_ms,1000);
 assert.equal(timed[2].mode,'burst');assert.equal(timed[2].burst_ms,500);assert.equal(timed[2].pause_ms,400);assert.equal(timed[2].interval_ms,25);
 assert.match(await page.eval(()=>document.querySelector('[aria-label="Edit K"]').textContent),/Hold 2 s · Pause 3 s/);
 await page.click('Edit K');await page.screenshot(resolve(output,'edit-960.png'));
 for(const width of[390,768,960,1440]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:900,deviceScaleFactor:1,mobile:false});
  for(const screen of['editor','list']){
   if(screen==='list')await page.click('Cancel');else if(!await page.eval(()=>!!document.querySelector('.clicker-editor')))await page.click('Edit K');
   assert(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.clicker-page *')].every(node=>{const box=node.getBoundingClientRect();return !box.width||box.right<=innerWidth+2;})),'Overflow in '+screen+' at '+width);
   await page.screenshot(resolve(output,screen+'-'+width+'.png'));
  }
  await page.click('Edit K');
 }
 await page.click('Clear action button');await page.click('Save item');
 assert(await page.eval(()=>document.querySelector('[aria-label="Start item"]').disabled));
 await page.click('Delete item');assert.equal(await page.eval(()=>document.querySelectorAll('.clicker-item').length),2);
 assert.deepEqual(page.errors,[]);
 console.log('PASS multi-item add/edit/delete; direct keyboard/mouse capture; Repeat/Hold; fractional delay and unit conversion; independent shortcuts; Clear persistence; disabled empty output; responsive layouts; no browser exceptions.');
}finally{await browser.close();}
