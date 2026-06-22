#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(command, ['--filter', '@re/web', 'dev', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('dev launcher failed:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
