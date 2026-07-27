/**
 * Ingest-time redaction.
 *
 * Vibe-coded apps ship whatever the model wrote. In practice that means event properties
 * arrive containing emails, bearer tokens, full names, and occasionally an entire user
 * row spread across `user_email`, `user_phone`, `address_line_1`. Our customers did not
 * intend to send that and cannot be relied on to prevent it.
 *
 * So we drop it at the door. Redaction runs before persistence, which means a leak in a
 * customer's generated code cannot become a breach in our database. This is a product
 * feature, not just a safeguard: "we refuse PII you accidentally send us" is a genuine
 * differentiator against every analytics tool that happily stores it.
 */

import type { PropertyValue } from './types.ts';

/** Free text beyond this is truncated — long strings are where PII hides. */
export const MAX_STRING_LENGTH = 256;

/** Property names that are dropped outright regardless of value. */
const BLOCKED_KEY_PATTERN =
  /(^|_)(email|e_mail|phone|mobile|ssn|sin|nino|passport|dob|birth|address|street|zip|postcode|postal|lat|lng|latitude|longitude|password|passwd|secret|token|api_key|apikey|authorization|auth|credit_card|card_number|cvv|iban|bsn)(_|$)/i;

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/gi },
  // Bearer/JWT-shaped tokens.
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Common provider key prefixes: sk-, pk_, ghp_, xoxb-, AKIA...
  { name: 'api_key', re: /\b(?:sk|pk|rk)[-_][A-Za-z0-9]{16,}\b/g },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  // E.164-ish phone numbers.
  { name: 'phone', re: /\b\+?[0-9][0-9\s().-]{8,17}[0-9]\b/g },
  { name: 'ipv4', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
  // 13-19 digit card-like runs, optionally separated.
  { name: 'card', re: /\b(?:\d[ -]?){13,19}\b/g },
];

export interface RedactionResult {
  properties: Record<string, PropertyValue>;
  /** What we removed, by rule name. Surfaced to the developer so they can fix the source. */
  findings: Array<{ key: string; rule: string }>;
}

function redactString(value: string): { value: string; rules: string[] } {
  let out = value;
  const rules: string[] = [];
  for (const { name, re } of PATTERNS) {
    // Reset lastIndex: these are module-level /g regexes reused across calls.
    re.lastIndex = 0;
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, `[redacted:${name}]`);
      rules.push(name);
    }
  }
  if (out.length > MAX_STRING_LENGTH) {
    out = out.slice(0, MAX_STRING_LENGTH);
    rules.push('truncated');
  }
  return { value: out, rules };
}

/**
 * Flatten and clean an arbitrary property bag.
 *
 * Nested objects are flattened one level then coerced; anything deeper is dropped rather
 * than stringified, because stringified blobs are exactly how PII sneaks past filters.
 */
export function redactProperties(input: Record<string, unknown>): RedactionResult {
  const properties: Record<string, PropertyValue> = {};
  const findings: Array<{ key: string; rule: string }> = [];

  const visit = (key: string, value: unknown, depth: number): void => {
    if (BLOCKED_KEY_PATTERN.test(key)) {
      findings.push({ key, rule: 'blocked_key' });
      return;
    }

    if (value === null || value === undefined) {
      properties[key] = null;
      return;
    }

    if (typeof value === 'boolean' || typeof value === 'number') {
      properties[key] = Number.isFinite(value as number) || typeof value === 'boolean'
        ? (value as PropertyValue)
        : null;
      return;
    }

    if (typeof value === 'string') {
      const { value: clean, rules } = redactString(value);
      for (const rule of rules) findings.push({ key, rule });
      properties[key] = clean;
      return;
    }

    if (Array.isArray(value)) {
      // Arrays become a count. The membership of a list is high-entropy and re-identifying.
      properties[`${key}_count`] = value.length;
      findings.push({ key, rule: 'array_collapsed' });
      return;
    }

    if (typeof value === 'object' && depth === 0) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(`${key}_${k}`, v, depth + 1);
      }
      return;
    }

    findings.push({ key, rule: 'unsupported_type' });
  };

  for (const [key, value] of Object.entries(input)) visit(key, value, 0);
  return { properties, findings };
}

/**
 * Coarsen an IP to a country code, then forget it.
 *
 * The real implementation calls a local MaxMind DB; the point of the signature is that
 * an IP is only ever an *input* to this function and is never returned or stored.
 */
export function ipToCountry(ip: string | undefined, lookup: (ip: string) => string | null): string | null {
  if (!ip) return null;
  return lookup(ip);
}
