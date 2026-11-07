import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Browser,delay} from './cdp.mjs';
const out=resolve('.taste-skill/voice');mkdirSync(out,{recursive:true});
const browser=await Browser.launch();
try{
 const page=await browser.newPage(process.env.TEST_URL||'http://127.0.0.1:1420',960,700);
 assert.deepEqual(await page.eval(()=>[...document.querySelectorAll('.tool-nav button')].map(node=>node.getAttribute('aria-label'))),['Recorder','Voice Recorder','Screenshot','Auto-clicker','Library']);
 await page.eval(()=>{
  window.voiceFixture={};
  navigator.mediaDevices.getUserMedia=async()=>{
   const audio=new AudioContext(),oscillator=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();
   oscillator.frequency.value=440;gain.gain.value=0;oscillator.connect(gain).connect(destination);oscillator.start();
   window.voiceFixture={audio,oscillator,gain,stream:destination.stream};
   return destination.stream;
  };
 });
 await page.tab('Voice Recorder');await page.click('Record voice');await page.wait(()=>document.querySelector('.voice-topline').textContent.includes('Listening'));
 const checksum=()=>page.eval(()=>{const canvas=document.querySelector('.audio-visualizer'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let sum=0;for(let i=3;i<pixels.length;i+=4)sum+=pixels[i];return sum;});
 await delay(120);const silence=await checksum();
 await page.eval(()=>window.voiceFixture.gain.gain.value=.18);await delay(220);assert.notEqual(await checksum(),silence,'Waveform must react to audio');
 await page.screenshot(resolve(out,'wave-dark.png'));
 await page.click('Equalizer view');await delay(180);const bars=await checksum();assert(bars>0);await page.screenshot(resolve(out,'bars-dark.png'));
 await page.eval(()=>window.voiceFixture.gain.gain.value=0);await delay(400);assert.notEqual(await checksum(),bars,'Bars must respond to silence');
 await page.eval(()=>window.voiceFixture.gain.gain.value=.16);await delay(300);
 await page.tab('Library');assert(await page.eval(()=>window.voiceFixture.stream.active));await page.tab('Voice Recorder');
 await page.click('Pause');const frozen=await page.eval(()=>document.querySelector('.voice-transport .timer').textContent);await delay(1250);assert.equal(await page.eval(()=>document.querySelector('.voice-transport .timer').textContent),frozen);
 await page.click('Use light theme',true);await page.screenshot(resolve(out,'paused-light.png'));
 await page.click('Resume');await delay(350);await page.click('Stop & save');await page.wait(()=>!!document.querySelector('.voice-playback audio'));
 assert(!await page.eval(()=>window.voiceFixture.stream.active),'Microphone tracks must be released');
 assert(await page.eval(()=>document.querySelector('.voice-playback audio').src.startsWith('blob:')));
 await page.eval(()=>{const audio=document.querySelector('.voice-playback audio');audio.muted=true;return audio.play();});
 assert.equal(await page.eval(()=>document.querySelector('.voice-playback audio').error),null);
 for(const width of [390,768,960]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:700,deviceScaleFactor:1,mobile:false});
  assert(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot(resolve(out,`voice-light-${width}.png`));
 }
 await page.eval(()=>{window.voiceFixture.oscillator.stop();return window.voiceFixture.audio.close();});
 assert.deepEqual(page.errors,[]);writeFileSync(resolve(out,'browser.json'),JSON.stringify({passed:true,realSignalReactivity:true,waveAndBars:true,pauseExcludesTime:true,trackCleanup:true,audioPlayback:true,widths:[390,768,960],errors:page.errors},null,2));
 console.log('PASS real audio waveform/equalizer reactivity, tab persistence, pause/resume timing, encoded audio playback, device cleanup and responsive themes.');
}finally{await browser.close();}
