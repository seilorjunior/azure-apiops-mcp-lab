import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseNotes } from '../scripts/release-notes.mjs';

test('release notes require a matching stable tag and versioned changelog', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\nNot released.\n\n## [1.2.3] - 2026-10-28\n\n### Added\n\n- Example.\n\n## [1.2.2]\n\nOld.\n';
  assert.equal(releaseNotes('v1.2.3', '1.2.3', changelog), '### Added\n\n- Example.\n');
  for (const tag of ['1.2.3', 'v1.2.4', 'v1.2.3-beta', undefined]) {
    assert.throws(() => releaseNotes(tag, '1.2.3', changelog), /Release tag/);
  }
  assert.throws(() => releaseNotes('v1.2.4', '1.2.4', changelog), /nonempty versioned/);
  assert.throws(() => releaseNotes('v1.2.3', '1.2.3', '## [1.2.3]\n'), /nonempty versioned/);
  assert.throws(() => releaseNotes('v1.2.3', '1.2.3', '## [1.2.3]'), /nonempty versioned/);
  assert.throws(() => releaseNotes('v01.2.3', '01.2.3', changelog), /Release tag/);
});
