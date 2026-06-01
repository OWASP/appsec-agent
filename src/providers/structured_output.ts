/**
 * Post-run structured output parsing and validation for non-Claude providers.
 *
 * Author: Sam Li
 */

export function extractJsonFromAssistantText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
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
    return { ok: false, errors: ['assistant text is not valid JSON'] };
  }
  const validation = validateRequiredJsonSchemaFields(parsed, schema);
  if (!validation.ok) {
    return validation;
  }
  return { ok: true, value: parsed };
}
