/**
 * Tests for post-run structured output parsing/validation.
 */

import { THREAT_MODEL_REPORT_SCHEMA } from '../schemas/threat_model_report';
import {
  extractJsonFromAssistantText,
  parseAndValidateStructuredOutput,
  validateRequiredJsonSchemaFields,
} from '../providers/structured_output';

describe('structured_output', () => {
  describe('extractJsonFromAssistantText', () => {
    it('parses raw JSON object', () => {
      const value = extractJsonFromAssistantText('{"a":1}');
      expect(value).toEqual({ a: 1 });
    });

    it('parses fenced JSON block', () => {
      const value = extractJsonFromAssistantText('```json\n{"a":1}\n```');
      expect(value).toEqual({ a: 1 });
    });

    it('extracts JSON embedded in prose', () => {
      const value = extractJsonFromAssistantText('Here is the report:\n{"a":1}\nDone.');
      expect(value).toEqual({ a: 1 });
    });

    it('extracts a fenced block that follows prose (open-weight model pattern)', () => {
      // DeepSeek/GLM often prepend commentary before the fenced report; a
      // whole-string fence match misses this and a brace slice is defeated by a
      // stray "{" in the prose.
      const text =
        "I've verified the source. Consider the set {a, b}.\n\n```json\n{\"threat_model_report\":{\"ok\":true}}\n```";
      const value = extractJsonFromAssistantText(text);
      expect(value).toEqual({ threat_model_report: { ok: true } });
    });

    it('prefers the largest fenced JSON block when several fences are present', () => {
      const text =
        'Example snippet:\n```json\n{"x":1}\n```\nFinal report:\n```json\n{"threat_model_report":{"a":1,"b":2}}\n```';
      const value = extractJsonFromAssistantText(text);
      expect(value).toEqual({ threat_model_report: { a: 1, b: 2 } });
    });

    it('returns null for invalid JSON', () => {
      expect(extractJsonFromAssistantText('not json')).toBeNull();
    });
  });

  describe('validateRequiredJsonSchemaFields', () => {
    it('passes when required keys exist', () => {
      const result = validateRequiredJsonSchemaFields(
        { threat_model_report: {} },
        THREAT_MODEL_REPORT_SCHEMA,
      );
      expect(result.ok).toBe(true);
    });

    it('fails when required keys are missing', () => {
      const result = validateRequiredJsonSchemaFields({}, THREAT_MODEL_REPORT_SCHEMA);
      expect(result).toEqual({
        ok: false,
        errors: ['missing required property: threat_model_report'],
      });
    });
  });

  describe('parseAndValidateStructuredOutput', () => {
    it('returns parsed value when schema validates', () => {
      const json = JSON.stringify({ threat_model_report: { metadata: {}, executive_summary: {}, findings: [] } });
      const result = parseAndValidateStructuredOutput(json, THREAT_MODEL_REPORT_SCHEMA);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty('threat_model_report');
      }
    });

    it('fails closed on malformed JSON and surfaces a text prefix', () => {
      const result = parseAndValidateStructuredOutput('oops', THREAT_MODEL_REPORT_SCHEMA);
      expect(result).toEqual({
        ok: false,
        errors: ['assistant text is not valid JSON (starts with: "oops")'],
      });
    });

    it('parses a schema-valid report wrapped in a fence after prose', () => {
      const text =
        'Reconciled findings against the code.\n\n```json\n' +
        JSON.stringify({ threat_model_report: { metadata: {}, findings: [] } }) +
        '\n```';
      const result = parseAndValidateStructuredOutput(text, THREAT_MODEL_REPORT_SCHEMA);
      expect(result.ok).toBe(true);
    });
  });
});
