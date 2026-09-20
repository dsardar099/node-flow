import type { JsonValue } from '@node-flow-dev/core';
import { AiTaskError, asRecord } from './ai.js';

/**
 * Guardrails for what goes to a model and what comes back.
 *
 * Declared on the task as `guardrails`:
 * ```json
 * { "redactPII": true, "blockedTerms": ["password", "/\\bssn\\b/i"],
 *   "blockedOutputTerms": ["guarantee"], "maxInputCharacters": 20000 }
 * ```
 * - **Redaction** replaces emails, phone numbers, card numbers and US social
 *   security numbers with a marker *before* the request leaves node-flow, and
 *   reports how many of each it replaced — not what they were.
 * - **Blocked terms** stop a request that mentions them, or fail a task whose
 *   answer does. A term is a case-insensitive whole word or phrase, or a
 *   `/regex/flags`.
 * - **A size cap** stops a runaway template from sending a whole document.
 *
 * A blocked request or answer fails **terminally**: the same input gives the
 * same verdict, so retrying would only spend the budget. A blocked answer is
 * withheld from the output, because recording it would defeat the point.
 */

export interface Guardrails {
  redactPII?: boolean | PiiKind[];
  blockedTerms?: string[];
  blockedOutputTerms?: string[];
  maxInputCharacters?: number;
}

export const PII_KINDS = ['email', 'phone', 'card', 'ssn'] as const;
export type PiiKind = (typeof PII_KINDS)[number];

const PII: Record<PiiKind, RegExp> = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Card-shaped digit runs, checked with Luhn so an order number is not taken for one.
  card: /\b(?:\d[ -]?){13,19}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  phone: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\b\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}\b/g,
};

export function readGuardrails(value: JsonValue | undefined): Guardrails | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = asRecord(value);
  const strings = (key: string) => {
    const list = raw[key];
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) throw new AiTaskError(`guardrails.${key} must be a list of strings`, true);
    return list as string[];
  };
  const redact = raw['redactPII'];
  if (redact !== undefined && typeof redact !== 'boolean' && !(Array.isArray(redact) && redact.every((k) => PII_KINDS.includes(k as PiiKind)))) {
    throw new AiTaskError(`guardrails.redactPII must be true, false or a list of ${PII_KINDS.join(', ')}`, true);
  }
  const max = raw['maxInputCharacters'];
  if (max !== undefined && (typeof max !== 'number' || max < 1)) throw new AiTaskError('guardrails.maxInputCharacters must be a positive number', true);
  return {
    redactPII: redact as Guardrails['redactPII'],
    blockedTerms: strings('blockedTerms'),
    blockedOutputTerms: strings('blockedOutputTerms'),
    maxInputCharacters: max as number | undefined,
  };
}

function matcher(term: string): RegExp {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(term);
  if (regex) {
    try {
      return new RegExp(regex[1], regex[2].replace('g', ''));
    } catch {
      throw new AiTaskError(`guardrail term ${term} is not a valid regular expression`, true);
    }
  }
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i');
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export class GuardedText {
  readonly redactions: Partial<Record<PiiKind, number>> = {};
  private characters = 0;

  constructor(private readonly rails: Guardrails | undefined) {}

  /** Redacts and checks one piece of text headed for the model. */
  input(text: string): string {
    const rails = this.rails;
    if (!rails) return text;
    this.characters += text.length;
    if (rails.maxInputCharacters && this.characters > rails.maxInputCharacters) {
      throw new AiTaskError(`blocked by guardrail: the request is over maxInputCharacters (${rails.maxInputCharacters})`, true);
    }
    for (const term of rails.blockedTerms ?? []) {
      if (matcher(term).test(text)) throw new AiTaskError(`blocked by guardrail: the request mentions a blocked term (${term})`, true);
    }
    const kinds = rails.redactPII === true ? PII_KINDS : Array.isArray(rails.redactPII) ? rails.redactPII : [];
    let out = text;
    // Cards before phones: a card number would otherwise be half-eaten as a phone.
    for (const kind of (['email', 'card', 'ssn', 'phone'] as const).filter((k) => kinds.includes(k))) {
      out = out.replace(PII[kind], (match) => {
        if (kind === 'card' && !luhn(match.replace(/\D/g, ''))) return match;
        this.redactions[kind] = (this.redactions[kind] ?? 0) + 1;
        return `[${kind.toUpperCase()} REDACTED]`;
      });
    }
    return out;
  }

  /** Checks the model's answer. */
  output(text: string): void {
    for (const term of this.rails?.blockedOutputTerms ?? []) {
      if (matcher(term).test(text)) throw new AiTaskError(`blocked by guardrail: the answer contains a blocked term (${term}) and was withheld`, true);
    }
  }

  /** What the task reports: counts only, never the redacted values. */
  report(): Record<string, JsonValue> | undefined {
    if (!this.rails) return undefined;
    return { redacted: { ...this.redactions } };
  }
}
