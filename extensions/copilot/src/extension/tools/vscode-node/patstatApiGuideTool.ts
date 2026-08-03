/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseApiGuideTool, GuideDocsData } from './baseApiGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that provides PATSTAT analytics API documentation to the LLM agent — the aggregate-statistics
 * layer over the self-hosted EPO PATSTAT Global database. Docs are fetched from the FlowLeap backend
 * through the shared {@link IPatentBackendClient} seam, so it inherits the centralized
 * `401 → re-sign-in` / `402 → start-trial` gating.
 *
 * Beyond endpoint/workflow docs, this guide serves the two data sections the guarded-SQL path
 * (Layer 2, `patstat_query`) depends on — `action: 'section'`:
 *  - `semantic-model`: the full semantic model YAML, verbatim (logical tables, metrics, join paths,
 *    caveats, and the `interpretation_conventions` block — the agent's contract for counting units
 *    and year bases). Fetch it BEFORE writing SQL; never work from memory of the schema.
 *  - `examples`: verified question→SQL pairs; entries with `promoted_to` have a dedicated typed
 *    endpoint — call that instead of regenerating SQL.
 *
 * For the standard portfolio question, PREFER the typed `patstat_portfolio` tool; for other
 * aggregate questions follow the `guarded-sql` workflow (action='workflow') with `patstat_query`.
 * This tool is the single source of truth for the PATSTAT routes' request shapes and conventions —
 * prompts and skills reference it at runtime so guidance never drifts from the backend.
 */
class PatstatApiGuideTool extends BaseApiGuideTool {

	public static readonly toolName = ToolName.PatstatApiGuide;

	protected readonly docsRoute = '/patstat/docs';
	protected readonly logPrefix = '[PatstatApiGuideTool]';
	protected readonly docsErrorLabel = 'PATSTAT analytics docs';
	protected readonly fullDocsTitle = '# PATSTAT Analytics API Documentation';
	protected readonly defaultInvocationMessage = 'Getting PATSTAT analytics API documentation';
	protected readonly listInvocationMessage = 'Listing available PATSTAT analytics endpoints';

	/**
	 * Purpose-built rendering for the two PATSTAT sections. The semantic model is passed through
	 * VERBATIM — it is the single authoritative source (backend ADR 0010); summarizing it here would
	 * recreate the drift the served-section design exists to prevent.
	 */
	protected override formatSectionDoc(data: GuideDocsData, sectionParam?: string): string {
		if (sectionParam === 'semantic-model' && typeof data.yaml === 'string') {
			return [
				'# PATSTAT Semantic Model (verbatim)',
				'',
				`Loaded edition: ${data.data_edition ?? 'unknown'} — cite this in every answer built on these views.`,
				'',
				'Apply the `interpretation_conventions` block below when writing SQL: default counting units and year bases, ask-when-material, and ALWAYS state the chosen interpretation in the answer.',
				'',
				'```yaml',
				data.yaml,
				'```',
			].join('\n');
		}

		if (sectionParam === 'examples' && Array.isArray(data.examples)) {
			const lines: string[] = [
				'# Verified PATSTAT Queries (question → SQL)',
				'',
				'Proven-correct pairs from the query repository. If one matches the user\'s question, reuse its SQL (adapted) — and if it carries `promoted_to`, call that dedicated endpoint/tool instead of writing SQL at all.',
				'',
			];
			for (const example of data.examples) {
				lines.push(`## ${example.question}`);
				if (example.promoted_to) {
					lines.push(`**Promoted:** use \`${example.promoted_to}\` instead of regenerating this SQL.`);
				}
				lines.push('```sql', example.logical_sql.trim(), '```', '');
			}
			return lines.join('\n');
		}

		return super.formatSectionDoc(data, sectionParam);
	}
}

ToolRegistry.registerTool(PatstatApiGuideTool);
