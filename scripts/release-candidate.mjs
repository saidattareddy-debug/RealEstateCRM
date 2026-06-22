#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  ['Migration order', ['pnpm', 'verify:migrations']],
  ['Official Supabase record', ['pnpm', 'verify:official-supabase']],
  ['Format check', ['pnpm', 'format:check']],
  ['Lint', ['pnpm', 'lint']],
  ['Typecheck', ['pnpm', 'typecheck']],
  ['Unit tests', ['pnpm', 'test']],
  ['Web tests', ['pnpm', 'test:web']],
  ['Embedded Postgres tests', ['pnpm', 'test:pg']],
  ['E2E compile check', ['pnpm', 'test:e2e:compile']],
  ['No external IO guard', ['pnpm', 'verify:no-external-io']],
  ['Production build', ['pnpm', 'build']],
  ['Secret scan', ['pnpm', 'verify:secrets']],
];

function run(label, command) {
  console.log(`\n=== ${label} ===`);
  const [file, ...args] = command;
  const result = spawnSync(file, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\nRelease candidate FAILED at step: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('Starting release-candidate verification...');
for (const [label, command] of steps) run(label, command);
console.log('\nRelease candidate PASSED.');
