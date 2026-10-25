#!/usr/bin/env node
// The repository's one check: every module parses and every test passes. No dependencies.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = dir => readdirSync(join(root, dir)).filter(f => f.endsWith('.mjs')).map(f => join(dir, f));
const run = args => spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'}).status === 0;

let ok = true;
for (const file of ['bin', 'src', 'foundation', 'scripts'].flatMap(files)) ok = run(['--check', file]) && ok;
ok = run(['--test', ...files('tests').filter(f => f.endsWith('.test.mjs'))]) && ok;
console.log(ok ? 'check: passed' : 'check: FAILED');
process.exitCode = ok ? 0 : 1;
