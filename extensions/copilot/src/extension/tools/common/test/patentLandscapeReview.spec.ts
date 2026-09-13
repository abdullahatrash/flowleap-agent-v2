/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { extractFigures, figureProvenance, LandscapeSnapshot, renderLandscapeAppendix, tablesWithoutBasis } from '../patentLandscapeReview';

/** One analytics outcome whose returned text carries the trend figures, and one search outcome. */
const snapshot: LandscapeSnapshot = {
	executions: [
		{ kind: 'analytics', status: 'succeeded', tool: 'patstat_portfolio', request: 'applicant=Acme; cpc=H01M', rowCount: 2, dataEdition: 'PATSTAT 2025 Autumn', resultText: '| 2019 | 1,240 |\n| 2024 | 1,860 |\nshare 91%' },
		{ kind: 'search', status: 'succeeded', total: 54, returned: 25 },
		{ kind: 'analytics', status: 'failed', tool: 'patstat_query', request: 'SELECT …', resultText: '4,500' },
	],
};

describe('landscape figure extraction', () => {
	it('reads the measurements and leaves years, identifiers and single digits out', () => {
		const content = [
			'| Year | Families |',
			'| --- | --- |',
			'| 2019 | 1,240 |',
			'| 2024 | 3 |',
			'',
			'The top filer holds 91% of the 12 granted families in A61K6/62; see [EP3477840](flowleap://flowleap.patent-ai/patent?publication=EP3477840). Growth averages 12.5 filings per year, and 1,240 families recur.',
		].join('\n');
		expect(extractFigures(content)).toEqual(['1,240', '91%', '12', '12.5']);
	});
});

describe('landscape figure provenance', () => {
	it('finds figures in recorded analytics text and search counts, and reports the rest as untraced', () => {
		expect(figureProvenance(['1,240', '91%', '54', '12.5', '4,500'], snapshot)).toEqual({
			matched: ['1,240', '91%', '54'],
			unmatched: ['12.5', '4,500'],
		});
	});
});

describe('landscape counting basis', () => {
	it('names every table whose header and the lines above it never say what is counted', () => {
		const content = [
			'## Filings',
			'Counts below are DOCDB families.',
			'',
			'| Year | Count |',
			'| --- | --- |',
			'| 2019 | 12 |',
			'',
			'| Applicant | Share |',
			'| --- | --- |',
			'| Acme | 40% |',
		].join('\n');
		expect(tablesWithoutBasis(content)).toEqual(['Applicant']);
	});
});

describe('landscape appendix', () => {
	it('states what was traced, what was not, and which recorded aggregate the report rests on', () => {
		const content = [
			'| Year | Families |',
			'| --- | --- |',
			'| 2019 | 1,240 |',
			'',
			'| Applicant | Share |',
			'| --- | --- |',
			'| Acme | 91% |',
			'',
			'Growth averages 12.5 per year.',
		].join('\n');
		expect(renderLandscapeAppendix(content, snapshot)).toEqual([
			'## Figure provenance (generated)',
			'Generated from this session\'s execution record, not supplied by the model. A figure is "found" when it appears in the text a tool returned; that is not a check of what it means, and a figure not found may still be a correct calculation from figures that were.',
			'3 figures checked against recorded tool outputs; 1 not found: 12.5.',
			'Tables without a stated counting basis: Applicant. Families, applications and publications are different units; state which one each table counts.',
			'',
			'## Data provenance (generated)',
			'- patstat_portfolio — applicant=Acme; cpc=H01M — 2 rows — PATSTAT 2025 Autumn',
		].join('\n'));
	});

	it('says plainly when no analytics outcome was recorded', () => {
		expect(renderLandscapeAppendix('No tables here.', { executions: [] })).toEqual([
			'## Figure provenance (generated)',
			'Generated from this session\'s execution record, not supplied by the model. A figure is "found" when it appears in the text a tool returned; that is not a check of what it means, and a figure not found may still be a correct calculation from figures that were.',
			'No figures were found in the report body; nothing was checked against recorded tool outputs.',
			'',
			'## Data provenance (generated)',
			'No analytics outcome was recorded for this session, so no figure in this report rests on a recorded aggregate.',
		].join('\n'));
	});
});
