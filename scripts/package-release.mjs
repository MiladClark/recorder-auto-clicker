import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Windows release packaging must run on Windows.');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
execFileSync('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('./package-release.ps1', import.meta.url)), '-Version', version], { stdio: 'inherit', windowsHide: true });
