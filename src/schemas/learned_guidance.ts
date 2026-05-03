/**
 * Learned-guidance synthesizer schemas (v2.5.0 / parent-app plan §3.8 — CLLG).
 *
 * The parent app collects three signal streams (dismissal validations,
 * `addressed` PR outcomes, 👍 feedback) and buckets them by CWE. For each
 * eligible bucket it asks this role to emit ONE short policy bullet that
 * captures the class-level pattern (e.g. *"Trust the CSRF middleware in
 * `auth/csrf.ts`; do not flag PR routes that go through it."*).
 *
 * Input file shape (passed via `--inputs <file>`; matches the JSON the
 * parent app's `runSynthesizerAgent` writes in `learnedGuidanceSynthesizer.ts`):
 *
 *     {
 *       "buckets": [
 *         {
 *           "cwe": "CWE-79",
 *           "signal_count": 12,
 *           "example_dismissal_reasons": [
 *             "duplicate of issue #4321 - already mitigated by helmet middleware",
 *             "auto-escaped by React JSX",
 *             ...
 *           ]
 *         },
 *         ...
 *       ]
 *     }
 *
 * Output shape on stdout (structured JSON, written to `-o <file>` per the
 * parent app's spawn contract; backend rejects anything off-schema with
 * `outcome=validation_error`):
 *
 *     {
 *       "bullets": [
 *         {
 *           "cwe": "CWE-79",
 *           "bullet": "≤300 chars positive-form rule the pr_reviewer can apply",
 *           "confidence": 0.85
 *         },
 *         ...
 *       ]
 *     }
 *
 * The role is a pure transform: no Read/Grep tools, no source-tree
 * access. Output is constrained by `LEARNED_GUIDANCE_OUTPUT_SCHEMA` so a
 * malformed bullet list never reaches the parent app's prompt budget.
 */

import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface LearnedGuidanceBucketInput {
  cwe: string;
  signal_count: number;
  example_dismissal_reasons: string[];
}

export interface LearnedGuidanceInputs {
  buckets: LearnedGuidanceBucketInput[];
}

/**
 * Hard caps applied at parse time. Generous on top of the parent app's
 * own caps in `learnedGuidanceSynthesizer.ts` (MAX_INPUTS_PER_BUCKET =
 * 50, MIN_BUCKET_SIZE = 5) so this validator only fires on truly
 * runaway inputs — e.g. someone hand-builds a malicious JSON file.
 */
const MAX_BUCKETS = 200;
const MAX_REASONS_PER_BUCKET = 200;
const MAX_REASON_LEN = 2_000;
const MAX_CWE_LEN = 64;

/** Output character cap. Stays in lockstep with the parent app's `MAX_BULLET_LEN = 300`. */
export const MAX_BULLET_LEN = 300;

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface LearnedGuidanceBullet {
  cwe: string;
  bullet: string;
  confidence: number;
}

export interface LearnedGuidanceOutput {
  bullets: LearnedGuidanceBullet[];
}

// ---------------------------------------------------------------------------
// Input parser / validator
// ---------------------------------------------------------------------------

/**
 * Parse and validate a `LearnedGuidanceInputs` object loaded from the
 * `--inputs` JSON file. Throws on any structural deviation; the CLI
 * wrapper in `main.ts` exits non-zero so the parent app sees the error
 * via stderr (and stays fail-closed: zero bullets persisted).
 */
export function parseLearnedGuidanceInputs(data: unknown): LearnedGuidanceInputs {
  if (!data || typeof data !== 'object') {
    throw new Error('Learned-guidance inputs must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.buckets)) {
    throw new Error('Learned-guidance inputs must include a "buckets" array');
  }
  if (o.buckets.length === 0) {
    throw new Error('Learned-guidance inputs must include at least one bucket');
  }
  if (o.buckets.length > MAX_BUCKETS) {
    throw new Error(`Learned-guidance inputs supports at most ${MAX_BUCKETS} buckets per run`);
  }

  const buckets: LearnedGuidanceBucketInput[] = [];
  for (const item of o.buckets) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each bucket must be an object');
    }
    const b = item as Record<string, unknown>;

    if (typeof b.cwe !== 'string' || !b.cwe.trim()) {
      throw new Error('Each bucket must include a non-empty string "cwe"');
    }
    if (b.cwe.length > MAX_CWE_LEN) {
      throw new Error(`Bucket "cwe" exceeds ${MAX_CWE_LEN} chars`);
    }

    if (typeof b.signal_count !== 'number' || !Number.isFinite(b.signal_count) || b.signal_count < 0) {
      throw new Error(`Bucket "${b.cwe}" must include a non-negative numeric "signal_count"`);
    }

    if (!Array.isArray(b.example_dismissal_reasons)) {
      throw new Error(`Bucket "${b.cwe}" must include an array "example_dismissal_reasons"`);
    }
    if (b.example_dismissal_reasons.length > MAX_REASONS_PER_BUCKET) {
      throw new Error(
        `Bucket "${b.cwe}" exceeds ${MAX_REASONS_PER_BUCKET} example_dismissal_reasons`,
      );
    }
    const reasons: string[] = [];
    for (const r of b.example_dismissal_reasons) {
      if (typeof r !== 'string') {
        throw new Error(`Bucket "${b.cwe}" example_dismissal_reasons must all be strings`);
      }
      // Truncate per-reason rather than reject — the parent app already
      // sanitizes/truncates, but be defensive against future drift.
      reasons.push(r.length > MAX_REASON_LEN ? r.slice(0, MAX_REASON_LEN) : r);
    }

    buckets.push({
      cwe: b.cwe.trim(),
      signal_count: Math.floor(b.signal_count),
      example_dismissal_reasons: reasons,
    });
  }

  return { buckets };
}

/**
 * Convenience loader matching the pattern used by `loadRetestContext`
 * etc. — read JSON from disk, parse, validate, return.
 *
 * Caller is responsible for path validation (we expect `main.ts` to run
 * the file path through `validateInputFilePath` before calling this so
 * traversal attempts never reach the loader).
 */
export function loadLearnedGuidanceInputs(absolutePath: string): LearnedGuidanceInputs {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Learned-guidance inputs file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Failed to parse learned-guidance inputs JSON: ${e?.message || e}`);
  }
  return parseLearnedGuidanceInputs(data);
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt for the synthesizer role. The prompt:
 *   1. States the task and the success bar (positive-form rule, not generic).
 *   2. Lists each bucket with its CWE, signal count, and a few example reasons.
 *   3. Reminds the model of the schema, the per-bullet length cap, and the
 *      confidence scale.
 *
 * The system prompt (set in `agent_options.ts`) plus the JSON schema
 * enforcement (set on `Options.outputFormat`) enforce the structural
 * contract; this prompt focuses on the *content* contract.
 */
export function buildLearnedGuidanceUserPrompt(inputs: LearnedGuidanceInputs): string {
  const lines: string[] = [
    '## Class-level Learned Guidance synthesis',
    '',
    'You are summarizing patterns observed in past **dismissed** security findings into ONE concise rule per CWE that a code reviewer can apply during the next PR scan to AVOID raising the same false-positive class again.',
    '',
    '### Quality bar for a bullet',
    `- **Positive form**: "Trust X in Y; do not flag Z." not "Past dismissals were noisy."`,
    `- **Specific**: cite a file path, function name, library, or framework feature wherever the example reasons mention one.`,
    `- **Self-contained**: a future reviewer reading ONLY the bullet must understand when to apply it.`,
    `- **≤ ${MAX_BULLET_LEN} characters**. Hard cap; longer bullets will be rejected.`,
    `- **Confidence in [0, 1]**: 0.9+ for "every example agrees on the same root cause", 0.6 for "majority agree", < 0.6 for "mixed signal" (will be dropped — return ONLY high-confidence bullets).`,
    '',
    '### Inputs',
    '',
  ];

  for (const b of inputs.buckets) {
    lines.push(`#### ${b.cwe} — ${b.signal_count} signal${b.signal_count === 1 ? '' : 's'}`);
    if (b.example_dismissal_reasons.length === 0) {
      lines.push('  _(no operator-supplied dismissal reasons; signal is from `addressed` outcomes / 👍 feedback only — be conservative)_');
    } else {
      lines.push('Example dismissal reasons (operator-supplied; may be terse):');
      for (const r of b.example_dismissal_reasons) {
        lines.push(`  - ${r.replace(/\n+/g, ' ')}`);
      }
    }
    lines.push('');
  }

  lines.push('### Output');
  lines.push('Return JSON matching the required schema:');
  lines.push('```json');
  lines.push(JSON.stringify(
    {
      bullets: [
        {
          cwe: '<CWE-XXX>',
          bullet: '<≤300-char positive-form rule>',
          confidence: 0.0,
        },
      ],
    },
    null,
    2,
  ));
  lines.push('```');
  lines.push('');
  lines.push('Skip any bucket where the dismissal reasons disagree or are too vague to ground a specific rule. It is BETTER to return zero bullets than to emit a bullet the reviewer cannot act on.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON Schema for Claude SDK structured output
// ---------------------------------------------------------------------------

export const LEARNED_GUIDANCE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['bullets'],
  properties: {
    bullets: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['cwe', 'bullet', 'confidence'],
        properties: {
          cwe: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_CWE_LEN,
            description: 'CWE identifier exactly as provided in the input bucket (e.g. "CWE-79").',
          },
          bullet: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_BULLET_LEN,
            description:
              'Positive-form policy rule the pr_reviewer can apply at scan time. Cite file/library/framework when the dismissal reasons do.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence in [0,1]. Bullets below 0.6 are dropped by the parent app.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

/** Convenience empty-output shell for tests / agent-side fallback. */
export function emptyLearnedGuidanceOutput(): LearnedGuidanceOutput {
  return { bullets: [] };
}
