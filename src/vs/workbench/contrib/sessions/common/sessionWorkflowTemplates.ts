/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/**
 * A patent workflow starter offered in the new-session composer. A template is
 * only prompt text plus display copy — picking one seeds the composer via
 * `prefillInput` and the session that results is an ordinary Claude session
 * (no dedicated session type or provider).
 */
export interface ISessionWorkflowTemplate {
	/** Stable identifier, e.g. 'prior-art-search'. */
	readonly id: string;
	/** Short chip label (title-style capitalization). */
	readonly label: string;
	/** One-line description shown as the chip's hover. */
	readonly description: string;
	/**
	 * Text seeded into the composer. Leads with the research task (e.g.
	 * "Prior-art search: …") so the session title derived from the first
	 * prompt reads like a research program entry, and invokes the
	 * corresponding bundled recipe skill by name. The `<…>` token marks
	 * where the user fills in their parameters before sending.
	 */
	readonly prompt: string;
}

/**
 * The patent workflow starters, mirroring the bundled recipe skills
 * (see `src/vs/sessions/skills/recipe-*`). Order is display order.
 */
export function getSessionWorkflowTemplates(): readonly ISessionWorkflowTemplate[] {
	return [
		{
			id: 'prior-art-search',
			label: localize('sessionTemplate.priorArt.label', "Prior-Art Search"),
			description: localize('sessionTemplate.priorArt.description', "Comprehensive prior-art search across patents and academic literature"),
			prompt: localize(
				'sessionTemplate.priorArt.prompt',
				"Prior-art search: <describe the invention, claim, or technology>\n\nUse the {0} skill to run a comprehensive prior-art search on the topic above, covering both patents and academic literature. Write the findings as a Markdown report in the working directory.",
				'recipe-prior-art-search'
			),
		},
		{
			id: 'freedom-to-operate',
			label: localize('sessionTemplate.fto.label', "Freedom to Operate"),
			description: localize('sessionTemplate.fto.description', "Freedom-to-operate search for a product or technology"),
			prompt: localize(
				'sessionTemplate.fto.prompt',
				"FTO analysis: <describe the product or technology and its target markets>\n\nUse the {0} skill to run a freedom-to-operate search for the product described above. Write the findings as a Markdown report in the working directory.",
				'recipe-freedom-to-operate'
			),
		},
		{
			id: 'patent-landscape',
			label: localize('sessionTemplate.landscape.label', "Patent Landscape"),
			description: localize('sessionTemplate.landscape.description', "Patent landscape analysis for a technology area"),
			prompt: localize(
				'sessionTemplate.landscape.prompt',
				"Patent landscape: <technology area>\n\nUse the {0} skill to run a patent landscape analysis for the technology area above. Write the findings as a Markdown report in the working directory.",
				'recipe-patent-landscape'
			),
		},
		{
			id: 'claim-analysis',
			label: localize('sessionTemplate.claims.label', "Claim Analysis"),
			description: localize('sessionTemplate.claims.description', "Extract and analyze the claims of a patent"),
			prompt: localize(
				'sessionTemplate.claims.prompt',
				"Claim analysis: <patent number, e.g. US10123456B2>\n\nUse the {0} skill to extract and analyze the claims of the patent above, with full context. Write the analysis as a Markdown report in the working directory.",
				'recipe-claim-analysis'
			),
		},
		{
			id: 'patent-to-report',
			label: localize('sessionTemplate.report.label', "Patent to Report"),
			description: localize('sessionTemplate.report.description', "Extract all data from a patent into a structured report"),
			prompt: localize(
				'sessionTemplate.report.prompt',
				"Patent report: <patent number, e.g. EP1234567B1>\n\nUse the {0} skill to extract all data from the patent above into a structured report. Write it as a Markdown report in the working directory.",
				'recipe-patent-to-report'
			),
		},
		{
			id: 'academic-literature-review',
			label: localize('sessionTemplate.academic.label', "Academic Literature Review"),
			description: localize('sessionTemplate.academic.description', "Academic literature review combined with patent analysis"),
			prompt: localize(
				'sessionTemplate.academic.prompt',
				"Literature review: <research topic>\n\nUse the {0} skill to run an academic literature review combined with patent analysis for the topic above. Write the findings as a Markdown report in the working directory.",
				'recipe-academic-literature-review'
			),
		},
	];
}
