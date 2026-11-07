// Single geometry source for the application mark and all exported variants.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'public/brand');
mkdirSync(directory, { recursive: true });
const path = 'M25 10V9a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h13a3 3 0 0 0 3-3v-1M14 11l7 5-7 5V11Z';
const mark = color => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 32 32" fill="none"><path d="${path}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
writeFileSync(resolve(directory, 'framecue-white.svg'), mark('#ffffff'));
writeFileSync(resolve(directory, 'framecue-dark.svg'), mark('#171717'));
writeFileSync(resolve(directory, 'framecue-icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256"><rect x="5" y="5" width="246" height="246" rx="58" fill="#171717" stroke="#626262" stroke-width="2"/><g transform="scale(8)" fill="none"><path d="${path}" stroke="#ffffff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></g></svg>\n`);
writeFileSync(resolve(root, 'public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><style>path{stroke:#171717}@media(prefers-color-scheme:dark){path{stroke:#fff}}</style><path d="${path}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`);
writeFileSync(resolve(root, 'src/components/BrandMark.tsx'), `/** FrameCue: an open capture frame surrounding a cue/playhead. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="${path}" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
`);
// Keep product metadata in sync; identity/storage stay stable across the rename.
const product = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
if (product.productName !== 'FrameCue') throw new Error('Unexpected product name.');
console.log('FrameCue vector assets and React mark generated.');
