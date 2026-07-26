/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { packageJson } from '../../../../platform/env/common/packagejson';
import { ContributedToolName, getContributedToolName, getToolName, mapContributedToolNamesInSchema, mapContributedToolNamesInString, toolCategories, ToolName } from '../toolNames';

describe('ToolNames', () => {
	it('Can map tool names', async () => {
		expect(getContributedToolName(ToolName.ApplyPatch)).toBe(ContributedToolName.ApplyPatch);
		expect(getToolName(ContributedToolName.ApplyPatch)).toBe(ToolName.ApplyPatch);
	});

	it('maps the search_patents contribution both ways so the patent prompt detects it', () => {
		// `copilot_searchPatents` must resolve to the internal `search_patents` name that
		// SearchPatentsTool registers under and that detectPatentTools() keys off — otherwise the
		// Patent Agent prompt stays inert. Bidirectional, so the tool is also advertised correctly.
		expect(getToolName(ContributedToolName.SearchPatents)).toBe(ToolName.SearchPatents);
		expect(getContributedToolName(ToolName.SearchPatents)).toBe(ContributedToolName.SearchPatents);
	});

	it('round-trips the claim-analysis tool family both ways', () => {
		// The claim-analysis family (analyze/compare/analytics) is wired only through the shared enum KEY
		// (toolNames.ts pairs the `copilot_*` contributed name with the `*` ToolName by key). A key typo
		// would silently sever the mapping so the tool never reaches its registration. Assert both directions.
		const family = [
			[ContributedToolName.AnalyzeClaim, ToolName.AnalyzeClaim],
			[ContributedToolName.CompareClaims, ToolName.CompareClaims],
			[ContributedToolName.PatentAnalyticsViz, ToolName.PatentAnalyticsViz],
		] as const;
		for (const [contributed, internal] of family) {
			expect(getToolName(contributed)).toBe(internal);
			expect(getContributedToolName(internal)).toBe(contributed);
		}
	});

	it('round-trips every patent search-family contributed name to its internal ToolName', () => {
		// The contributed `copilot_*` name and the internal `*` ToolName are linked only by their shared
		// enum KEY (the loop in toolNames.ts pairs them by key). A typo on either side silently breaks the
		// mapping and the tool would never reach its registration. Assert both directions for the whole family.
		const family = [
			[ContributedToolName.BuildPatentQuery, ToolName.BuildPatentQuery],
			[ContributedToolName.BuildUSPTOQuery, ToolName.BuildUSPTOQuery],
			[ContributedToolName.PatentApiRequest, ToolName.PatentApiRequest],
			[ContributedToolName.OpsApiGuide, ToolName.OpsApiGuide],
			[ContributedToolName.USPTOApiGuide, ToolName.USPTOApiGuide],
		] as const;
		for (const [contributed, internal] of family) {
			expect(getToolName(contributed)).toBe(internal);
			expect(getContributedToolName(internal)).toBe(contributed);
		}
	});

	it('round-trips the citation tool family contributed names to their internal ToolNames', () => {
		// The citation family is wired only through the shared enum KEY (toolNames.ts pairs the
		// `copilot_*` contributed name with the `*` ToolName by key). A key typo would silently sever the
		// mapping so the tool never reaches its registration, and `search_citations` would never light up
		// the Patent Agent prompt. Assert both directions for the whole family.
		const family = [
			[ContributedToolName.SearchCitations, ToolName.SearchCitations],
			[ContributedToolName.SearchForwardCitations, ToolName.SearchForwardCitations],
			[ContributedToolName.CitationApiGuide, ToolName.CitationApiGuide],
		] as const;
		for (const [contributed, internal] of family) {
			expect(getToolName(contributed)).toBe(internal);
			expect(getContributedToolName(internal)).toBe(contributed);
		}
	});

	it('round-trips the details/figures/PDF tool family both ways', () => {
		// Same key-pairing contract as the search family: each details/figures/PDF tool only reaches
		// its registration if its `copilot_*` contribution and internal ToolName share an enum key.
		const family = [
			[ContributedToolName.GetPatentDetails, ToolName.GetPatentDetails],
			[ContributedToolName.GetPatentFigures, ToolName.GetPatentFigures],
			[ContributedToolName.ReadPdf, ToolName.ReadPdf],
		] as const;
		for (const [contributed, internal] of family) {
			expect(getToolName(contributed)).toBe(internal);
			expect(getContributedToolName(internal)).toBe(contributed);
		}
	});

	it('locks the full patent tool set (registry parity) so a missing or renamed patent tool fails CI', () => {
		// Authoritative list of all 22 patent tools, keyed by their shared enum KEY. Each key must resolve to a
		// ToolName value, a ContributedToolName value (same key), a toolCategories entry, and a matching
		// `languageModelTools` contribution in package.json — and the contributed<->internal names must round-trip.
		// `satisfies` pins each key to a real member of BOTH enums, so a renamed/removed enum member fails to
		// compile; the runtime checks below catch a dropped category, a missing/renamed package.json contribution,
		// or a severed key pairing. This includes `patentSearchSubagent`: it is a patent tool in the registry even
		// though the PatentResearch agent intentionally does not grant it.
		const PATENT_TOOL_KEYS = [
			'BuildPatentQuery',
			'BuildUSPTOQuery',
			'SearchPatents',
			'SearchAcademic',
			'GetPatentDetails',
			'GetPatentFigures',
			'ReadPdf',
			'SearchCitations',
			'SearchForwardCitations',
			'CitationApiGuide',
			'SearchLegal',
			'LegalSearchGuide',
			'AnalyzeClaim',
			'CompareClaims',
			'PatentAnalyticsViz',
			'PatentApiRequest',
			'OpsApiGuide',
			'USPTOApiGuide',
			'WritePatentResults',
			'PatentSearchSubagent',
			'PatstatPortfolio',
			'PatstatApiGuide',
		] as const satisfies readonly (keyof typeof ToolName & keyof typeof ContributedToolName)[];

		const contributedNames = new Set(packageJson.contributes.languageModelTools.map(tool => tool.name));
		const problems = PATENT_TOOL_KEYS.map(key => {
			const toolName = ToolName[key];
			const contributedName = ContributedToolName[key];
			const issues: string[] = [];
			if (!Object.prototype.hasOwnProperty.call(toolCategories, toolName)) {
				issues.push('missing toolCategories entry');
			}
			if (!contributedNames.has(contributedName)) {
				issues.push('missing languageModelTools contribution in package.json');
			}
			if (getToolName(contributedName) !== toolName || getContributedToolName(toolName) !== contributedName) {
				issues.push('contributed<->internal round-trip broken');
			}
			return { key, issues };
		}).filter(entry => entry.issues.length > 0);

		expect({ count: PATENT_TOOL_KEYS.length, duplicates: PATENT_TOOL_KEYS.length - new Set(PATENT_TOOL_KEYS).size, problems })
			.toEqual({ count: 22, duplicates: 0, problems: [] });
	});

	it('returns original name for unmapped core tools', () => {
		// Core tool without a contributed alias
		const unmapped = ToolName.CoreRunInTerminal;
		const mapped = getContributedToolName(unmapped);
		expect(mapped).toBe(unmapped);
	});

	it('mapContributedToolNamesInString replaces all contributed tool names with core names', () => {
		const input = `Use ${ContributedToolName.ReplaceString} and ${ContributedToolName.ReadFile} in sequence.`;
		const output = mapContributedToolNamesInString(input);
		expect(output).toContain(ToolName.ReplaceString);
		expect(output).toContain(ToolName.ReadFile);
		expect(output).not.toContain(ContributedToolName.ReplaceString);
		expect(output).not.toContain(ContributedToolName.ReadFile);
	});

	it('mapContributedToolNamesInSchema replaces strings recursively', () => {
		const schema = {
			one: `before ${ContributedToolName.ReplaceString} after`,
			nested: {
				two: `${ContributedToolName.ReadFile}`,
				arr: [
					`${ContributedToolName.FindFiles}`,
					42,
					{ three: `${ContributedToolName.FindTextInFiles}` },
				],
			},
			unchanged: 123,
		};
		const mapped: any = mapContributedToolNamesInSchema(schema);
		expect(mapped.one).toContain(ToolName.ReplaceString);
		expect(mapped.nested.two).toBe(ToolName.ReadFile);
		expect(mapped.nested.arr[0]).toBe(ToolName.FindFiles);
		expect(mapped.nested.arr[1]).toBe(42);
		expect(mapped.nested.arr[2].three).toBe(ToolName.FindTextInFiles);
		expect(mapped.unchanged).toBe(123);
	});
});