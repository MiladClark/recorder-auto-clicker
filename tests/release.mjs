import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Browser, delay, installTestSource } from './cdp.mjs';
const endpoint = process.env.WEBVIEW_DEBUG_URL || 'http://127.0.0.1:9224';
const output = resolve('.taste-skill/release');
const captures = resolve(output, 'captures');
mkdirSync(captures, { recursive: true });
let version;
for (let attempt = 0; attempt < 30; attempt++) {
  try { version = await (await fetch(endpoint + '/json/version')).json(); break; } catch { await delay(300); }
}
assert(version, 'Start FrameCue.exe with the WebView2 debug port 9224 for this explicit release check.');
let target;
for (let attempt = 0; attempt < 30; attempt++) { const targets = await (await fetch(endpoint + '/json/list')).json(); target = targets.find(target => target.title.includes('FrameCue')); if (target) break; await delay(200); }
assert(target, 'The production app did not finish starting.');
const browser = await Browser.connect(version.webSocketDebuggerUrl);
try {
  const page = await browser.attach(target.id);
  await page.wait(() => !!document.querySelector('.recorder-page'));
  const state = await page.eval(async () => ({
    url: location.href, tauri: !!window.__TAURI_INTERNALS__, font: document.fonts.check('13px Inter'),
    fontFile: (await fetch('/fonts/inter.woff2')).ok,
    directories: await window.__TAURI_INTERNALS__.invoke('get_output_dirs'),
  }));
  assert(state.tauri && state.font && state.fontFile);
  assert(!state.url.includes('1420'));
  console.log('PASS production executable starts from embedded assets, with bundled font and native IPC, without a dev server');
  await page.screenshot(resolve(output, 'FrameCue-0.5.0.png'));
  const previous = await page.eval(() => localStorage.getItem('omnipulse.recorder.destination.v1'));
  await page.eval(folder => localStorage.setItem('omnipulse.recorder.destination.v1', JSON.stringify(folder)), captures);
  await page.send('Page.reload'); await page.wait(() => !!document.querySelector('.recorder-page'));
  await installTestSource(page);
  await page.click('Choose capture source'); await page.wait(() => document.querySelector('.preview-topline').textContent.includes('Source connected'));
  await page.click('Start recording'); await page.wait(() => document.querySelector('.preview-topline').textContent.includes('Recording'));
  await delay(1500); await page.click('Stop & save');
  await page.wait(() => document.querySelector('.recorder-page').textContent.includes('Recording saved.'));
  assert(!await page.eval(() => !!document.querySelector('.recorder-page [role=alert]')));
  const files = await page.eval(() => window.__TAURI_INTERNALS__.invoke('list_recordings'));
  const video = files.find(file => file.path.toLowerCase().startsWith(captures.toLowerCase()) && file.kind === 'video');
  assert(video && readFileSync(video.path).length > 1000);
  await page.tab('Library');
  await page.wait(() => !!document.querySelector('.media-row'));
  await page.eval(name => [...document.querySelectorAll('.media-row')].find(row => row.textContent.includes(name)).querySelector('.media-description').click(), video.name);
  await page.wait(() => document.querySelector('.media-dialog video')?.readyState >= 1);
  assert(await page.eval(() => document.querySelector('.media-dialog video').videoWidth > 0));
  await page.click('Close preview', true);
  console.log('PASS production recording, disk streaming and saved-video playback under release CSP');
  for (const tab of ['Screenshot', 'Auto-clicker', 'Recorder']) {
    await page.tab(tab); assert(await page.eval(() => !!document.querySelector('.workspace > div:not([hidden]) h1')));
  }
  console.log('PASS all tools navigate in the standalone release');
  await page.eval(previous => { if (previous === null) localStorage.removeItem('omnipulse.recorder.destination.v1'); else localStorage.setItem('omnipulse.recorder.destination.v1', previous); }, previous);
  assert(video.path.toLowerCase().startsWith(captures.toLowerCase()));
  unlinkSync(video.path);
  await page.send('Page.reload'); await page.wait(() => !!document.querySelector('.recorder-page'));
  await page.screenshot(resolve(output, 'FrameCue-0.5.0.png'));
  assert.deepEqual(page.errors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ passed: true, state, videoBytes: video.size_bytes, uncaughtErrors: page.errors }, null, 2));
  console.log('PASS release validation finished and synthetic capture was removed');
} finally { await browser.close(); }
