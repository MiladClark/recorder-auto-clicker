import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Browser {
  constructor() { this.next = 0; this.pending = new Map(); this.events = new Map(); }
  static async connect(url) {
    const browser = new Browser();
    browser.ws = new WebSocket(url);
    await new Promise((resolve, reject) => { browser.ws.onopen = resolve; browser.ws.onerror = reject; });
    browser.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && browser.pending.has(message.id)) {
        const pending = browser.pending.get(message.id); browser.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else (browser.events.get(message.method) || []).forEach(callback => callback(message));
    };
    return browser;
  }
  static async launch() {
    const exe = process.env.CHROME_PATH || [
      join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].find(existsSync);
    if (!exe) throw new Error('Set CHROME_PATH to a Chrome or Edge executable.');
    const profile = mkdtempSync(join(tmpdir(), 'omnipulse-test-'));
    const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const url = await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('Browser startup timed out.')), 20000);
      child.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.on('error', reject);
    });
    const browser = await Browser.connect(url); browser.child = child; browser.profile = profile; return browser;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Timed out: ' + method)); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId);
    await page.send('Runtime.enable'); await page.send('Page.enable');
    return page;
  }
  async newPage(url, width = 1120, height = 830) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const page = await this.attach(targetId);
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url });
    await page.wait(() => !!document.querySelector('.page h1'));
    await page.wait(() => !document.querySelector('.devtune-splash'));
    return page;
  }
  async close() {
    if (this.child) { await this.send('Browser.close').catch(() => {}); this.child.kill(); await delay(300); }
    this.ws.close();
    if (this.profile) rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}
class Page {
  constructor(browser, session) { this.browser = browser; this.session = session; this.errors = []; browser.events.set('Runtime.exceptionThrown', [...(browser.events.get('Runtime.exceptionThrown') || []), message => { if (message.sessionId === session) this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); }]); }
  send(method, params) { return this.browser.send(method, params, this.session); }
  async eval(fn, arg) {
    const expression = typeof fn === 'function' ? '(' + fn.toString() + ')(' + JSON.stringify(arg ?? null) + ')' : fn;
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async wait(fn, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await this.eval(fn)) return; await delay(100); }
    throw new Error('Condition timed out: ' + fn.toString());
  }
  async click(text, all = false) {
    await this.eval(({ text, all }) => {
      const scope = all ? document : document.querySelector('.workspace > div:not([hidden])');
      const button = [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text || node.querySelector('strong')?.textContent === text);
      if (!button) throw new Error('Missing button: ' + text);
      if (button.disabled) throw new Error('Disabled button: ' + text);
      button.click();
    }, { text, all });
  }
  async tab(text) { await this.eval(value => [...document.querySelectorAll('.tool-nav button')].find(node => node.textContent.trim() === value).click(), text); await delay(80); }
  async screenshot(path) { const result = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(result.data, 'base64')); }
}
export async function installTestSource(page) {
  await page.eval(() => {
    window.testStreams = [];
    navigator.mediaDevices.getDisplayMedia = async options => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d'); let frame = 0;
      const paint = () => { context.fillStyle = '#202020'; context.fillRect(0, 0, 640, 360); context.fillStyle = '#ee696c'; context.fillRect(frame++ % 600, 60, 40, 180); context.fillStyle = '#fff'; context.font = '24px sans-serif'; context.fillText('FrameCue integration capture', 32, 310); };
      paint(); const interval = setInterval(paint, 33);
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0]; const stop = track.stop.bind(track); track.stop = () => { clearInterval(interval); stop(); };
      if (options.audio) {
        const audio = new AudioContext(); const oscillator = audio.createOscillator(); const volume = audio.createGain(); volume.gain.value = 0;
        const destination = audio.createMediaStreamDestination(); oscillator.connect(volume).connect(destination); oscillator.start();
        const audioTrack = destination.stream.getAudioTracks()[0]; const stopAudio = audioTrack.stop.bind(audioTrack); audioTrack.stop = () => { oscillator.stop(); void audio.close(); stopAudio(); };
        stream.addTrack(audioTrack);
      }
      window.testStreams.push(stream); return stream;
    };
  });
}
