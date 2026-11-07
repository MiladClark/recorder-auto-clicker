import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Browser, delay, installTestSource } from './cdp.mjs';
const out = resolve('.taste-skill/themes');
mkdirSync(out, { recursive: true });
const browser = await Browser.launch();
const reports = [];
const url = process.env.TEST_URL || 'http://127.0.0.1:1420';
const theme = (page, name) => page.click(`Use ${name} theme`, true);

// Calculate contrast against the rendered opaque background, including nested surfaces.
const contrast = page => page.eval(() => {
  const rgb = value => value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
  const luminance = color => color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const background = element => {
    const chain = []; for (let node = element; node; node = node.parentElement) chain.unshift(node);
    return chain.reduce((base, node) => { const color = rgb(getComputedStyle(node).backgroundColor); const alpha = color[3] ?? 1; return base.map((value, index) => value * (1 - alpha) + color[index] * alpha); }, [255, 255, 255]);
  };
  const nodes = [...document.querySelectorAll('body *')].filter(node => {
    const rect = node.getBoundingClientRect();
    return rect.width && rect.height && rect.top < innerHeight && rect.bottom > 0 && !node.closest('svg,[disabled],[aria-disabled=true],.click-speed-preview[data-mode=idle]') && ([...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) || node instanceof HTMLInputElement && node.type !== 'checkbox');
  });
  const results = nodes.map(node => ({ label: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 45), ratio: +ratio(rgb(getComputedStyle(node).color), background(node)).toFixed(2), color: getComputedStyle(node).color, background: background(node) }));
  return { minimum: Math.min(...results.map(item => item.ratio)), failures: results.filter(item => item.ratio < 4.5), count: results.length };
});

try {
  const page = await browser.newPage(url, 960, 700);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await page.eval(() => localStorage.clear());
  await page.send('Page.reload');
  await page.wait(() => document.documentElement.dataset.theme === 'dark' && !!document.querySelector('.page h1') && !document.querySelector('.devtune-splash'));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await page.wait(() => document.documentElement.dataset.theme === 'light');
  await theme(page, 'dark');
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  assert.equal(await page.eval(() => document.documentElement.dataset.theme), 'dark');
  for (const name of ['dark', 'colorful', 'light']) {
    await theme(page, name);
    await delay(200);
    assert.equal(await page.eval(() => localStorage.getItem('framecue.theme.v1')), name);
    assert.equal(await page.eval(() => getComputedStyle(document.documentElement).colorScheme), name === 'light' ? 'light' : 'dark');
    const tokens = await page.eval(() => {
      const css = getComputedStyle(document.documentElement);
      return Object.fromEntries(['--ground','--surface','--text','--brand','--coral','--blue','--amber'].map(key => [key, css.getPropertyValue(key).trim()]));
    });
    if (name === 'dark') {
      assert.equal(tokens['--ground'],'#171717');assert.equal(tokens['--surface'],'#202020');
      assert.equal(new Set(['--brand','--coral','--blue','--amber'].map(key => tokens[key])).size,1,'Dark controls should be monochrome');
    }
    if (name === 'colorful') {assert.equal(tokens['--ground'],'#101413');assert.equal(tokens['--amber'],'#eec67a');}
    for (const tab of ['Recorder', 'Voice Recorder', 'Screenshot', 'Library', 'Auto-clicker']) {
      await page.tab(tab);
      if (tab === 'Recorder') await page.click('Recording settings');
      if (tab === 'Library') await page.click('Library filters');
      if (tab === 'Auto-clicker') await page.click('Add item');
      const colors = await contrast(page);
      assert.deepEqual(colors.failures, [], `${name} ${tab}: ${JSON.stringify(colors.failures)}`);
      reports.push({ theme: name, tab, ...colors });
      await page.screenshot(resolve(out, `${name}-${tab.toLowerCase()}.png`));
      if (tab === 'Auto-clicker') {
        for (const width of [390, 768]) {
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 700, deviceScaleFactor: 1, mobile: false });
          assert(await page.eval(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.theme-switch button')].every(node => node.getBoundingClientRect().right <= innerWidth)));
          assert(await page.eval(() => { const unit = document.querySelector('[aria-label="Delay unit"]>span'); return unit.scrollWidth <= unit.clientWidth; }), 'Delay unit is truncated at ' + width);
          await page.screenshot(resolve(out, `${name}-editor-${width}.png`));
        }
        await page.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 700, deviceScaleFactor: 1, mobile: false });
        await page.click('Cancel');
      }
      if (tab === 'Library') {
        await page.click('Sort captures');
        const menuColors = await contrast(page);
        assert.deepEqual(menuColors.failures, [], name + ' menu');
        await page.screenshot(resolve(out, `${name}-menu.png`));
        await page.eval(() => document.querySelector('[role=option][data-value="largest"]').click());
      }
    }
  }
  await page.send('Page.reload');
  await page.wait(() => !!document.querySelector('.page h1') && !document.querySelector('.devtune-splash'));
  assert.equal(await page.eval(() => document.documentElement.dataset.theme), 'light');
  const other = await browser.newPage(url);
  await theme(page, 'dark');
  await other.wait(() => document.documentElement.dataset.theme === 'dark');
  await theme(other, 'light');
  await page.wait(() => document.documentElement.dataset.theme === 'light');
  await theme(page, 'colorful');
  await other.wait(() => document.documentElement.dataset.theme === 'colorful');
  await page.send('Page.reload');
  await page.wait(() => document.documentElement.dataset.theme === 'colorful' && !!document.querySelector('.page h1') && !document.querySelector('.devtune-splash'));
  assert.equal(await page.eval(() => getComputedStyle(document.documentElement).colorScheme),'dark');
  await installTestSource(page);
  await page.click('Choose capture source');
  await page.wait(() => !document.querySelector('.transport .button.primary').disabled);
  await page.click('Start recording');
  await theme(page, 'dark');
  assert(await page.eval(() => !![...document.querySelectorAll('.transport button')].find(node => node.textContent === 'Stop & save') && window.testStreams[0].active));
  await page.click('Stop & save');
  await delay(200);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(other.errors, []);
  writeFileSync(resolve(out, 'browser.json'), JSON.stringify({ passed: true, reports, persistence: true, windowSync: true, followsSystemUntilChosen: true, recorderSurvivesThemeSwitch: true, widths: [390, 768, 960], errors: page.errors }, null, 2));
  console.log('PASS dark, colorful and light themes on all five tools; neutral dark controls; preserved color palette; >=4.5 text contrast; menus; responsive title controls; persistence; window sync; OS fallback; uninterrupted recording.');
} finally { await browser.close(); }
