'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const FIXTURE = path.join(__dirname, 'types', 'openapi.ts');

test('public OpenApi options allow omitted or explicit namespaceName', () => {
  assert.doesNotThrow(() => {
    execFileSync(
      process.execPath,
      [
        TSC,
        '--noEmit',
        '--strict',
        '--target',
        'ES2020',
        '--module',
        'commonjs',
        '--moduleResolution',
        'node',
        '--skipLibCheck',
        FIXTURE,
      ],
      { cwd: ROOT, stdio: 'pipe' }
    );
  });
});
