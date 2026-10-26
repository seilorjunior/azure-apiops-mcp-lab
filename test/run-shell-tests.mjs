import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const suites = process.platform === 'win32'
  ? [
    ['pwsh', ['-NoProfile', '-File', 'test\\promotion.test.ps1']],
    ['pwsh', ['-NoProfile', '-File', 'test\\preprovision.test.ps1']],
  ]
  : [['bash', ['test/bash.test.sh']]];

for (const [command, args] of suites) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
