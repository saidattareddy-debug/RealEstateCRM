import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENV_FILES = [
  '.env.local',
  '.env.demo-staging',
  '.env',
  path.join('apps', 'web', '.env.local'),
  path.join('apps', 'web', '.env'),
];

function decodeDoubleQuoted(value) {
  return value.replace(/\\([\\nrt"])/g, (_, ch) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return ch;
    }
  });
}

function parseEnvValue(rawValue) {
  const value = rawValue.trimStart();
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === quote) return quote === '"' ? decodeDoubleQuoted(out) : out;
      if (quote === '"' && ch === '\\' && i + 1 < value.length) {
        out += '\\' + value[++i];
        continue;
      }
      out += ch;
    }
    return quote === '"' ? decodeDoubleQuoted(out) : out;
  }

  const commentIndex = value.search(/\s#/);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}

function isPlaceholderValue(value) {
  const normalized = value.trim();
  if (!normalized) return true;
  if (normalized === '...') return true;
  if (/<[^>]+>/.test(normalized)) return true;
  return /^(YOUR_|YOUR-|REPLACE_|CHANGE_ME|CHANGEME|EXAMPLE_)/i.test(normalized);
}

export function parseEnvText(text) {
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex === -1) continue;

    const key = normalized.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = parseEnvValue(normalized.slice(eqIndex + 1));
    if (!Object.hasOwn(parsed, key)) {
      parsed[key] = value;
      continue;
    }
    if (isPlaceholderValue(parsed[key]) && !isPlaceholderValue(value)) parsed[key] = value;
  }
  return parsed;
}

export function loadLocalEnv({
  cwd = process.cwd(),
  files = DEFAULT_ENV_FILES,
  env = process.env,
} = {}) {
  const loadedFiles = [];
  const loadedKeys = [];

  for (const relativePath of files) {
    const absolutePath = path.resolve(cwd, relativePath);
    if (!fs.existsSync(absolutePath)) continue;

    const parsed = parseEnvText(fs.readFileSync(absolutePath, 'utf8'));
    let used = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] !== undefined) continue;
      env[key] = value;
      loadedKeys.push(key);
      used = true;
    }
    if (used) loadedFiles.push(absolutePath);
  }

  return { env, loadedFiles, loadedKeys };
}
