import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const content = readFileSync('.github/CODEOWNERS', 'utf8');
const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const rules = lines.map(line => line.split(/\s+/));
const byPath = new Map(rules.map(([path, ...owners]) => [path, owners]));

test('CODEOWNERS contains only valid nonempty ownership rules', () => {
  assert.equal(byPath.size, rules.length, 'duplicate rule path hides ownership');
  for (const [path, ...owners] of rules) {
    assert.ok(path.startsWith('/') || path === '*', 'ownership rule must be rooted or default');
    assert.ok(owners.length > 0, 'unowned path cannot be allowed');
    for (const owner of owners) assert.match(owner, /^@[a-zA-Z0-9-]+$/, 'invalid GitHub owner');
  }
});

test('high-risk IAM boundaries require the verified independent owner', () => {
  const critical = [
    '/.github/CODEOWNERS', '/.github/workflows/', '/.github/e2e/',
    '/database/', '/apps/web/src/app/api/', '/apps/web/src/lib/auth0*',
    '/apps/web/src/lib/authorization*', '/apps/web/src/lib/db*',
    '/scripts/', '/docs/architecture/', '/docs/operations/',
  ];
  for (const path of critical) {
    assert.deepEqual(byPath.get(path), ['@alexoaraujo83'], `${path} needs independent code owner`);
  }
  assert.deepEqual(byPath.get('*'), ['@alexoaraujo', '@alexoaraujo83']);
});
