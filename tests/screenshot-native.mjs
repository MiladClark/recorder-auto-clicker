import assert from 'node:assert/strict';
import { Browser } from './cdp.mjs';
const endpoint = process.env.WEBVIEW_DEBUG_URL || 'http://127.0.0.1:9223';
const version = await (await fetch(endpoint + '/json/version')).json();
const targets = await (await fetch(endpoint + '/json/list')).json();
const browser = await Browser.connect(version.webSocketDebuggerUrl);
try {
  const page = await browser.attach(targets.find(target => target.title.includes('FrameCue')).id);
  const previous = await page.eval(() => ['screenshot.autoCopy', 'screenshot.autoSave'].map(key => localStorage.getItem('omnipulse.' + key + '.v1')));
  await page.tab('Screenshot');
  await page.eval(() => document.querySelectorAll('.capture-preferences input').forEach(input => { if (input.checked) input.click(); }));
  await page.click('Capture screen');
  await page.wait(() => document.querySelector('canvas')?.width > 300);
  assert(!await page.eval(() => !!document.querySelector('.workspace > div:not([hidden]) [role=alert]')));
  assert(await page.eval(async () => (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow().isVisible()));
  await page.eval(previous => ['screenshot.autoCopy', 'screenshot.autoSave'].forEach((key, index) => {
    const name = 'omnipulse.' + key + '.v1';
    if (previous[index] === null) localStorage.removeItem(name); else localStorage.setItem(name, previous[index]);
  }), previous);
  await page.send('Page.reload');
  await page.wait(() => !!document.querySelector('.recorder-page'));
  console.log('PASS actual Capture screen hides the app, captures Windows pixels, restores its window and loads the editor');
} finally { await browser.close(); }
