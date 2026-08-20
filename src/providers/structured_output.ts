/**
 * Post-run structured output parsing and validation for non-Claude providers.
 *
 * Author: Sam Li
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse `candidate` as a JSON object, falling back to slicing the first `{` to
 * the last `}` when the string has surrounding noise. Returns `null` if neither
 * attempt yields valid JSON.
 */
function tryParseJsonObject(candidate: string): unknown | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function extractJsonFromAssistantText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Open-weight models (DeepSeek, GLM, …) frequently prepend prose and wrap the
  // report in a ```json fenced block ("I've verified the source. Here is the
  // report:\n```json\n{…}\n```"). A whole-string fence match misses that, and a
  // first-`{`…last-`}` slice is defeated by a stray `{` in the prose. So collect
  // every fenced block, largest first (the structured report is the big one),
  // and try each before falling back to the raw text and a brace slice.
  const candidates: string[] = [];
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(trimmed)) !== null) {
    const inner = match[1].trim();
    if (inner) candidates.push(inner);
  }
  candidates.sort((a, b) => b.length - a.length);
  candidates.push(trimmed);

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Minimal JSON Schema required-field check (no external validator). */
export function validateRequiredJsonSchemaFields(
  value: unknown,
  schema: Record<string, unknown>,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['root value must be a JSON object'] };
  }

  const required = schema.required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === 'string' && !(key in (value as Record<string, unknown>))) {
        errors.push(`missing required property: ${key}`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function parseAndValidateStructuredOutput(
  text: string,
  schema: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  const parsed = extractJsonFromAssistantText(text);
  if (parsed === null) {
    // Optional diagnostic: when APPSEC_DUMP_INVALID_JSON names a directory, dump
    // the full unparseable assistant text there so the exact malformation can be
    // inspected offline. No-op (and swallowed) by default.
    const dumpDir = process.env.APPSEC_DUMP_INVALID_JSON;
    if (dumpDir) {
      try {
        fs.mkdirSync(dumpDir, { recursive: true });
        const file = path.join(dumpDir, `invalid_json_${Date.now()}.txt`);
        fs.writeFileSync(file, text, 'utf-8');
        // eslint-disable-next-line no-console
        console.error(`[diag] dumped unparseable assistant text (${text.length} chars) to ${file}`);
      } catch {
        // best-effort diagnostic only
      }
    }
    const prefix = text.trim().slice(0, 120).replace(/\s+/g, ' ');
    return {
      ok: false,
      errors: [`assistant text is not valid JSON (starts with: "${prefix}")`],
    };
  }
  const validation = validateRequiredJsonSchemaFields(parsed, schema);
  if (!validation.ok) {
    return validation;
  }
  return { ok: true, value: parsed };
}
