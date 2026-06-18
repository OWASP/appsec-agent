/**
 * Adversarial second-pass input for threat_modeler — filters threats by code-grounded evidence.
 */
import type { ThreatModelReport } from './threat_model_report';

export interface ThreatAdversaryPassContext {
  threat_model_report: ThreatModelReport['threat_model_report'];
}

/**
 * Parse and validate threat adversary context (first-pass threat model report JSON).
 */
export function parseThreatAdversaryPassContext(data: unknown): ThreatAdversaryPassContext {
  if (!data || typeof data !== 'object') {
    throw new Error('Threat adversary context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!o.threat_model_report || typeof o.threat_model_report !== 'object') {
    throw new Error('Threat adversary context must include a "threat_model_report" object');
  }
  const tmr = o.threat_model_report as Record<string, unknown>;
  const threatModel = tmr.threat_model as { threats?: unknown[] } | undefined;
  const threats = threatModel?.threats;
  if (!Array.isArray(threats)) {
    throw new Error('threat_model_report.threat_model.threats must be an array');
  }
  if (threats.length > 500) {
    throw new Error('Threat adversary pass supports at most 500 threats per run');
  }
  return { threat_model_report: o.threat_model_report as ThreatModelReport['threat_model_report'] };
}

/**
 * Build the user message for the threat_adversary role.
 */
export function buildThreatAdversaryUserPrompt(
  ctx: ThreatAdversaryPassContext,
  opts: { additionalContext?: string },
): string {
  const lines: string[] = [
    '## Adversarial STRIDE threat review (second pass)',
    '',
    'You are given a first-pass threat model report. For each threat, you must either **keep** it or **drop** it.',
    '',
    '**Keep** only if Read/Grep against the source tree shows a *concrete* attack path: a plausible trigger, affected code (with `source_locations`: real `file`, `line_numbers`, optional `symbol`, and a short verbatim `snippet` of at most ~15 lines), and a security-relevant outcome.',
    '**Drop** threats that are generic/boilerplate, already mitigated by code you can see, test-only, or that you cannot ground in specific source evidence. Do not fabricate locations — omit `source_locations` when you cannot confirm them.',
    '',
    'Return one JSON object matching the required `threat_model_report` schema:',
    '- Filter `threat_model.threats` to survivors only; update `executive_summary` accordingly.',
    '- Reconcile `risk_registry.risks`: remove risks whose `related_threats` were all dropped; trim dropped threat ids from survivors; update `risk_registry.summary`.',
    '- Recompute `metadata.total_threats_identified` and `metadata.total_risks_identified` to match filtered arrays.',
    '- Preserve `data_flow_diagram` unchanged (nodes, flows, trust boundaries). You may add or confirm `source_locations` on DFD nodes when backed by evidence.',
    '',
  ];

  if (opts.additionalContext) {
    lines.push('### Project / deployment context (from integrator)');
    lines.push(opts.additionalContext);
    lines.push('');
  }

  lines.push('### First-pass threat model report (input)');
  lines.push('```json');
  lines.push(JSON.stringify(ctx, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(
    'Analyze with Read/Grep against the source tree as needed, then output the filtered full threat model report JSON only (structured output).',
  );

  return lines.join('\n');
}
