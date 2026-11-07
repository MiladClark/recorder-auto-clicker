import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Browser, delay } from './cdp.mjs';

const out = resolve('.taste-skill/selects');
mkdirSync(out, { recursive: true });
const browser = await Browser.launch();
const key = async (page, value, code = value, vk = 0) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: vk });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: vk });
  await delay(25);
};
const focus = (page, label) => page.eval(label => document.querySelector(`[role=combobox][aria-label="${label}"]`).focus(), label);
const choose = async (page, label, value) => {
  await page.click(label);
  await page.eval(value => [...document.querySelectorAll('[role=option]')].find(node => node.dataset.value === value).click(), value);
};
const placement = async page => {
  await delay(150);
  const result = await page.eval(() => {
    const button = document.querySelector('[role=combobox][aria-expanded=true]');
    const list = document.querySelector('[role=listbox]');
    const anchor = button.getBoundingClientRect(), rect = list.getBoundingClientRect();
    return { below: rect.top >= anchor.bottom + 5, left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, options: list.querySelectorAll('[role=option]').length, clipped: list.clientHeight < list.scrollHeight };
  });
  assert(result.below, JSON.stringify(result));
  assert(result.left >= 0 && result.right <= result.width + 1 && result.bottom <= result.height, JSON.stringify(result));
  return result;
};
try {
  const page = await browser.newPage(process.env.TEST_URL || 'http://127.0.0.1:1420', 960, 700);
  assert.equal(await page.eval(() => document.querySelectorAll('select').length), 0);
  await page.click('Recording settings');
  await choose(page, 'Quality', '16');
  assert.match(await page.eval(() => document.querySelector('[aria-label=Quality]').textContent), /Ultra/);
  await focus(page, 'Quality');
  await key(page, 'Home', 'Home', 36);
  await key(page, 'Enter', 'Enter', 13);
  assert.match(await page.eval(() => document.querySelector('[aria-label=Quality]').textContent), /Standard/);
  await page.tab('Library');
  await focus(page, 'Sort captures');
  await key(page, 'ArrowDown', 'ArrowDown', 40);
  const placements = [await placement(page)];
  await key(page, 'End', 'End', 35);
  await key(page, 'Enter', 'Enter', 13);
  assert.equal(await page.eval(() => document.querySelector('[aria-label="Sort captures"]').textContent), 'Name');
  await key(page, 'ArrowUp', 'ArrowUp', 38);
  await key(page, 'Home', 'Home', 36);
  await key(page, 'Escape', 'Escape', 27);
  assert.equal(await page.eval(() => document.querySelector('[aria-label="Sort captures"]').textContent), 'Name');
  await key(page, 'l', 'KeyL', 76);
  await key(page, 'Enter', 'Enter', 13);
  assert.equal(await page.eval(() => document.querySelector('[aria-label="Sort captures"]').textContent), 'Largest');
  await page.click('Sort captures');
  await key(page, 'Tab', 'Tab', 9);
  assert.equal(await page.eval(() => document.querySelector('[role=listbox]')), null);
  assert(await page.eval(() => document.activeElement.getAttribute('aria-label') !== 'Sort captures'));
  await page.click('Sort captures');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 80, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 80, button: 'left', clickCount: 1 });
  assert.equal(await page.eval(() => document.querySelector('[role=listbox]')), null);
  await page.click('Library filters');
  await choose(page, 'Capture date', 'week');
  assert.equal(await page.eval(() => document.querySelector('[aria-label="Capture date"]').textContent), 'Last 7 days');
  for (const width of [390, 768, 960]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 700, deviceScaleFactor: 1, mobile: false });
    await page.click('Sort captures');
    placements.push({ width, ...await placement(page) });
    await page.screenshot(resolve(out, `library-${width}.png`));
    await focus(page, 'Sort captures');
    await key(page, 'Escape', 'Escape', 27);
    assert(await page.eval(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.tab('Auto-clicker');
  await page.click('Add item');
  await page.eval(() => { const input = document.querySelector('#clicker-delay'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1000'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await choose(page, 'Delay unit', 's');
  assert.equal(await page.eval(() => document.querySelector('#clicker-delay').value), '1');
  await page.click('Delay unit');
  placements.push(await placement(page));
  await page.screenshot(resolve(out, 'clicker-960.png'));
  await key(page, 'Escape', 'Escape', 27);
  const frames = await page.eval(() => {
    const styles = selector => { const style = getComputedStyle(document.querySelector(selector)); return { border: style.borderTopWidth, outline: style.outlineWidth }; };
    return { panel: styles('.clicker-editor'), input: styles('#clicker-delay'), select: styles('[aria-label="Delay unit"]'), rail: getComputedStyle(document.querySelector('.icon-rail')).borderRightWidth };
  });
  assert.equal(frames.panel.border, '1px');
  assert.equal(frames.rail, '1px');
  assert.equal(frames.input.outline, '0px');
  assert.equal(frames.select.outline, '0px');
  assert.deepEqual(page.errors, []);
  writeFileSync(resolve(out, 'browser.json'), JSON.stringify({ passed: true, frames, placements, keyboard: ['arrows', 'Home', 'End', 'typeahead', 'Enter', 'Escape', 'Tab'], unitConversion: true, outsideDismiss: true, errors: page.errors }, null, 2));
  console.log('PASS dropdown selection, keyboard, outside dismissal, below-control placement at 390/768/960, unit conversion and restored structural borders.');
} finally { await browser.close(); }
