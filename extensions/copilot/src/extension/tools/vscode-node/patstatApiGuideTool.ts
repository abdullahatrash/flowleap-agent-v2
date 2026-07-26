/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseApiGuideTool } from './baseApiGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that provides PATSTAT analytics API documentation to the LLM agent — the aggregate-statistics
 * layer over the self-hosted EPO PATSTAT Global database (portfolio today; trends, landscape,
 * citations, family, legal-events as they ship). Docs are fetched from the FlowLeap backend through
 * the shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 *
 * For the standard portfolio question, PREFER the typed `patstat_portfolio` tool — this guide is the
 * discovery path for analytics endpoints that have no typed tool yet (called via
 * `patent_api_request`). Cross-repo contract: the backend's `GET /v1/patstat/docs` manifest emits the
 * shared `GuideDocsResponse` shape (see {@link BaseApiGuideTool}); until that route ships
 * (flowleap-backend#141 lists it as a follow-up), this tool surfaces the backend's error.
 *
 * This tool is the single source of truth for the PATSTAT routes' request shapes. Prompts and skills
 * should not hardcode parameter names — call this tool at runtime so guidance never drifts from the
 * backend.
 */
class PatstatApiGuideTool extends BaseApiGuideTool {

	public static readonly toolName = ToolName.PatstatApiGuide;

	protected readonly docsRoute = '/patstat/docs';
	protected readonly logPrefix = '[PatstatApiGuideTool]';
	protected readonly docsErrorLabel = 'PATSTAT analytics docs';
	protected readonly fullDocsTitle = '# PATSTAT Analytics API Documentation';
	protected readonly defaultInvocationMessage = 'Getting PATSTAT analytics API documentation';
	protected readonly listInvocationMessage = 'Listing available PATSTAT analytics endpoints';
}

ToolRegistry.registerTool(PatstatApiGuideTool);
