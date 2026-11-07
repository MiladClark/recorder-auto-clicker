import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const { productName } = config;
if (manifest.version !== config.version) throw new Error('Package and application versions must match.');
const command = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm tauri build --no-bundle'], { cwd: root, stdio: 'inherit', windowsHide: true })
  : spawnSync('pnpm', ['tauri', 'build', '--no-bundle'], { cwd: root, stdio: 'inherit' });
if (command.status !== 0) process.exit(command.status ?? 1);
const version = manifest.version;
const executable = resolve(root, 'src-tauri/target/release/framecue.exe');
if (!existsSync(executable)) throw new Error('No Windows executable was produced.');
const executableBytes = readFileSync(executable);
const peOffset = executableBytes.readUInt32LE(0x3c);
if (executableBytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0' ||
    executableBytes.readUInt16LE(peOffset + 24 + 68) !== 2) {
  throw new Error('The release must use the Windows GUI subsystem; console builds open an unwanted terminal.');
}
const release = resolve(root, 'release');
mkdirSync(release, { recursive: true });
const filename = productName + '-' + version + '.exe';
const destination = resolve(release, filename);
const current = resolve(root, productName + '.exe');
if (process.platform === 'win32') {
  const close = spawnSync('powershell.exe', ['-NoProfile', '-File', resolve(root, 'scripts/close-app.ps1'), '-Launcher', current, '-Release', destination], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (close.status !== 0) throw new Error('The running app could not be closed safely. The existing executable was kept.');
}
if (existsSync(current)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(resolve(release, 'previous'), { recursive: true });
  copyFileSync(current, resolve(release, 'previous', productName + '-' + stamp + '.exe'));
}
copyFileSync(executable, destination);
copyFileSync(executable, current);
const hash = createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(resolve(release, 'SHA256SUMS.txt'), hash + '  ' + filename + '\n');
console.log('\nReady: ' + destination + '\nUpdated launcher: ' + current + '\nSHA-256: ' + hash);
