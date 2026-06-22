#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { loadLocalEnv } from './load-local-env.mjs';

const repoRoot = process.cwd();
const appDir = path.join(repoRoot, 'apps', 'web');
const nextDir = path.join(appDir, '.next');
const port = process.env.PORT || '3000';

loadLocalEnv();

function findListeningPid(targetPort) {
  try {
    const output = execFileSync('lsof', ['-nP', '-t', `-iTCP:${targetPort}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.split('\n').find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function processCwd(pid) {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = output.split('\n').find((entry) => entry.startsWith('n') && entry.length > 1);
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !isRunning(pid);
}

async function stopRepoDevServer(targetPort) {
  const pidValue = findListeningPid(targetPort);
  if (!pidValue) return;

  const pid = Number(pidValue);
  const cwd = processCwd(pid);
  if (!cwd || cwd !== appDir) {
    console.error(
      `Refusing to stop port ${targetPort}: listening process is not this repo's apps/web dev server.`,
    );
    process.exit(1);
  }

  console.log(`Stopping dev server on port ${targetPort} (pid ${pid})...`);
  process.kill(pid, 'SIGTERM');
  if (await waitForExit(pid, 5000)) return;

  console.log(`Force-stopping stuck dev server on port ${targetPort} (pid ${pid})...`);
  process.kill(pid, 'SIGKILL');
  if (!(await waitForExit(pid, 2000))) {
    console.error(`Unable to stop pid ${pid}.`);
    process.exit(1);
  }
}

async function main() {
  await stopRepoDevServer(port);

  console.log(`Removing ${path.relative(repoRoot, nextDir)} ...`);
  fs.rmSync(nextDir, { recursive: true, force: true });

  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = spawn(command, ['--filter', '@re/web', 'dev', ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('dev reset launcher failed:', error.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

await main();
