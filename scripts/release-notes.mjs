import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseNotes(tag, version, changelog) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '') || tag !== `v${version}`) {
    throw new Error('Release tag must be v<package.json version> (stable SemVer).');
  }
  const heading = `## [${version}]`;
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find((entry) => `## ${entry.split('\n')[0]}` === heading ||
    `## ${entry.split('\n')[0]}`.startsWith(`${heading} - `));
  const notes = section?.split('\n').slice(1).join('\n').trim();
  if (!notes) throw new Error('Add a nonempty versioned CHANGELOG.md entry before tagging.');
  return `${notes}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(releaseNotes(process.argv[2], version,
    readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')));
}
