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
				"Prior-art search: <describe the invention, claim, or technology>\n\nUse the recipe-prior-art-search skill to run a comprehensive prior-art search on the topic above, covering both patents and academic literature. Write the findings as a Markdown report in the working directory."
			),
		},
	];
}
