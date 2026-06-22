/**
 * Prompt-injection detection for untrusted ingested/customer content
 * (Phase 5A §15). Retrieved content is always treated as DATA, never as
 * instructions. This detector returns a safe category (never the raw malicious
 * text) for security-event logging.
 */

export type InjectionCategory =
  | 'instruction_override'
  | 'system_prompt_exfiltration'
  | 'credential_request'
  | 'tool_or_sql_request'
  | 'role_manipulation'
  | 'url_exfiltration';

export interface InjectionFinding {
  detected: boolean;
  categories: InjectionCategory[];
}

const PATTERNS: { category: InjectionCategory; re: RegExp }[] = [
  {
    category: 'instruction_override',
    re: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|above|prior|all)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?)\b/i,
  },
  { category: 'instruction_override', re: /\bnew\s+(instructions?|rules?)\s*:/i },
  {
    category: 'system_prompt_exfiltration',
    re: /\b(reveal|show|print|repeat|output)\b[^.\n]{0,30}\b(system\s*prompt|your\s+instructions|the\s+prompt)\b/i,
  },
  {
    category: 'credential_request',
    re: /\b(api[_\s-]?key|secret|password|token|credential|service[_\s-]?role)\b/i,
  },
  {
    category: 'tool_or_sql_request',
    re: /\b(run|execute|call)\b[^.\n]{0,20}\b(sql|query|tool|function|command)\b/i,
  },
  { category: 'tool_or_sql_request', re: /\b(drop|delete|update|insert)\s+(table|into|from)\b/i },
  {
    category: 'role_manipulation',
    re: /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|from\s+now\s+on\s+you)\b/i,
  },
  { category: 'role_manipulation', re: /\b(developer|admin|root|system)\s+mode\b/i },
  { category: 'url_exfiltration', re: /\b(send|post|exfiltrate|upload)\b[^.\n]{0,30}https?:\/\//i },
];

export function detectInjection(text: string): InjectionFinding {
  const found = new Set<InjectionCategory>();
  for (const { category, re } of PATTERNS) {
    if (re.test(text)) found.add(category);
  }
  return { detected: found.size > 0, categories: [...found] };
}

/**
 * Wrap untrusted retrieved content in an explicitly-delimited data block so the
 * model treats it as reference data, not instructions. The delimiter is fixed
 * and documented; instructions inside the block are to be ignored.
 */
export function wrapUntrustedContext(label: string, content: string): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9 _-]/g, '');
  return `<<<UNTRUSTED_DATA name="${safeLabel}">>>\n${content}\n<<<END_UNTRUSTED_DATA>>>`;
}
