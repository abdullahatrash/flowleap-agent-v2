/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The invented matters of the drafting regression eval (PRD 0022 E4) and the prompt of each case.
 *
 * A matter is a folder under `fixtures/` with the files of `drafting/<matter>/`: `feature-list.md`,
 * `figures.md`, `claims.md` (approved), `disclosure.md`, and one hand-written Draft Outline per
 * office, `draft-outline-us.md` and `draft-outline-epo.md`. The Feature List is written for the US;
 * {@link loadMatter} sets its `office` to the office of the case, so one folder serves both offices.
 *
 * The prompt is what `start_application_draft` returns (Feature List, figures, Approved Claims and,
 * for a draft case, the Draft Outline), plus the disclosure the rows cite, plus the instruction of
 * the case. The pre-outline baseline is the skill without `references/outline-format.md`: for it the
 * draft prompt has no outline (see README, "Drafting suite").
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DraftingOffice, parseDraftingFrontmatter, writeDraftingFrontmatter } from '../../../src/extension/tools/common/drafting/frontmatter';
import { sha256Hex } from '../../../src/util/node/crypto';
import { resolveSkillsDir } from '../../providers/skill-grounded-provider';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The skill under test, and the reference file only the outline version of it has. */
export const DRAFTING_SKILL = 'application-drafting';
export const OUTLINE_REFERENCE = 'references/outline-format.md';

/** The files of one matter, for one office. */
export interface DraftingMatter {
	readonly name: string;
	readonly office: DraftingOffice;
	/** `feature-list.md`, with `office` set to the office of the case. */
	readonly featureList: string;
	readonly figures: string;
	readonly claims: string;
	readonly disclosure: string;
	/** The hand-written Draft Outline of the office, bound to the claims. */
	readonly outline: string;
	/** The SHA-256 of the Approved Claims, as the drafting tools compute it. */
	readonly claimsHash: string;
}

/** The SHA-256 of the Approved Claims as `draftingWorkspace.ts` computes it (`sha256Hex` of the body after the frontmatter, trimmed). */
export function approvedClaimsHash(claims: string): string {
	return sha256Hex(parseDraftingFrontmatter(claims).body.trim());
}

/** Reads a case var naming the office. */
export function readCaseOffice(value: string | undefined): DraftingOffice {
	if (value !== 'US' && value !== 'EPO') {
		throw new Error(`Drafting case office must be US or EPO, got "${value}".`);
	}
	return value;
}

/** Loads the files of a matter for one office. */
export function loadMatter(name: string, office: DraftingOffice): DraftingMatter {
	const folder = path.join(FIXTURES_DIR, name);
	const read = (file: string) => fs.readFileSync(path.join(folder, file), 'utf-8');
	const featureList = read('feature-list.md');
	const claims = read('claims.md');
	return {
		name,
		office,
		featureList: writeDraftingFrontmatter({ ...parseDraftingFrontmatter(featureList).fields, office }, featureList),
		figures: read('figures.md'),
		claims,
		disclosure: read('disclosure.md'),
		outline: read(`draft-outline-${office.toLowerCase()}.md`),
		claimsHash: approvedClaimsHash(claims),
	};
}

/** True when the skill folder of this run plans with a Draft Outline (false for the pre-outline baseline). */
function skillHasOutline(skillsDir: string): boolean {
	return fs.existsSync(path.join(skillsDir, DRAFTING_SKILL, OUTLINE_REFERENCE));
}

/** The kind of a drafting case. */
export type DraftingCaseKind = 'outline' | 'draft';

function body(text: string): string {
	return parseDraftingFrontmatter(text).body.trim();
}

const replyRule = 'There is no tool to call in this run: your reply is the content of the save. Reply with the content of the file only, with no text before or after it.';

/**
 * The user message of a case: the inputs as `start_application_draft` returns them, the disclosure,
 * and the instruction of the case kind. `withOutline` false is the pre-outline baseline: the draft
 * prompt then has no outline.
 */
export function buildDraftingPrompt(matter: DraftingMatter, kind: DraftingCaseKind, withOutline: boolean): string {
	const folder = `drafting/${matter.name}`;
	const sections = [
		`Draft the patent application of matter "${matter.name}" with the ${DRAFTING_SKILL} skill. I set the gates; you called start_application_draft and it returned:`,
		`Drafting started for matter "${matter.name}". Office: ${matter.office}. Gates read from the files: \`confirmed: true\` in ${folder}/feature-list.md, \`approved: true\` in ${folder}/claims.md. style/ has no exemplar, and ${folder}/inventor-answers.md does not exist yet.`,
		`## Feature List (${folder}/feature-list.md)\n\n${body(matter.featureList)}`,
		`## Figures (${folder}/figures.md)\n\n${body(matter.figures)}`,
		`## Approved Claims (${folder}/claims.md)\n\n${body(matter.claims)}`,
	];
	if (kind === 'draft' && withOutline) {
		sections.push(`## Draft Outline (${folder}/draft-outline.md)\n\n${body(matter.outline)}`);
	}
	sections.push(`You also read the invention disclosure that the Feature List cites (${folder}/disclosure.md):\n\n${matter.disclosure.trim()}`);
	if (kind === 'outline') {
		sections.push(`Now do Step 3a only: write the Draft Outline for ${folder}/draft-outline.md. ${replyRule}`);
	} else if (withOutline) {
		sections.push(`The Draft Outline above is saved for the Approved Claims. Now do Steps 3b and 3c: write the Draft Application for ${folder}/draft-application.md in outline order, and make the corrections of the integration pass in the draft. Leave the advisory items out of the reply. ${replyRule}`);
	} else {
		sections.push(`Now do Step 3: write the Draft Application for ${folder}/draft-application.md. Leave the advisory items out of the reply. ${replyRule}`);
	}
	return sections.join('\n\n');
}

/** The promptfoo prompt function of the drafting suite (`vars.matter`, `vars.office`, `vars.kind`). */
export default function draftingPrompt(context: { readonly vars: Readonly<Record<string, string>> }): string {
	const { matter, office, kind } = context.vars;
	if (kind !== 'outline' && kind !== 'draft') {
		throw new Error(`Drafting case kind must be outline or draft, got "${kind}".`);
	}
	return buildDraftingPrompt(loadMatter(matter, readCaseOffice(office)), kind, skillHasOutline(resolveSkillsDir(undefined, process.env)));
}
