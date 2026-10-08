/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DRAFTING_STYLE_FOLDER, matchDraftPath, resolveDraftingFolder } from '../drafting/folderContract';

describe('Application Drafting folder contract', () => {

	it('resolves the per-draft files of a matter, workspace-relative', () => {
		expect({ style: DRAFTING_STYLE_FOLDER, folder: resolveDraftingFolder('acme-hinge') }).toEqual({
			style: 'style',
			folder: {
				matter: 'acme-hinge',
				folder: 'drafting/acme-hinge',
				featureList: 'drafting/acme-hinge/feature-list.md',
				figures: 'drafting/acme-hinge/figures.md',
				claims: 'drafting/acme-hinge/claims.md',
				draft: 'drafting/acme-hinge/draft-application.md',
				generatedSnapshot: 'drafting/acme-hinge/draft-application.generated.md',
				workingRecord: 'drafting/acme-hinge/draft-application.working-record.md',
				findings: 'drafting/acme-hinge/findings.md',
				docx: {
					description: 'drafting/acme-hinge/draft-application.description.docx',
					claims: 'drafting/acme-hinge/draft-application.claims.docx',
					abstract: 'drafting/acme-hinge/draft-application.abstract.docx',
				},
				filingManifest: 'drafting/acme-hinge/filing-manifest.md',
			},
		});
	});

	it('refuses a matter name that is empty or leaves the drafting folder', () => {
		expect(['', '  ', '../secrets', 'a/b', 'a\\b', '.hidden'].map(matter => resolveDraftingFolder(matter))).toEqual([
			undefined, undefined, undefined, undefined, undefined, undefined,
		]);
	});

	it('reads the matter of a draft path, and nothing from any other path', () => {
		expect(['drafting/hinge/draft-application.md', 'drafting/hinge/claims.md', 'outputs/draft-application.md', 'drafting/a/b/draft-application.md', 'drafting/.hidden/draft-application.md'].map(matchDraftPath)).toEqual([
			'hinge', undefined, undefined, undefined, undefined,
		]);
	});
});
