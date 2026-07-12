/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ForkSessionOptions, ForkSessionResult, GetSubagentMessagesOptions, ListSubagentsOptions, Options, Query, SDKAssistantMessage, SDKResultMessage, SDKSessionInfo, SDKUserMessage, SessionMessage, Settings } from '@anthropic-ai/claude-agent-sdk';
import type { IClaudeCodeSdkService } from '../claudeCodeSdkService';

/**
 * Mock implementation of IClaudeCodeService for testing
 */
export class MockClaudeCodeSdkService implements IClaudeCodeSdkService {
	readonly _serviceBrand: undefined;
	public queryCallCount = 0;
	public setModelCallCount = 0;
	public lastSetModel: string | undefined;
	public setPermissionModeCallCount = 0;
	public lastSetPermissionMode: string | undefined;
	public applyFlagSettingsCallCount = 0;
	public lastAppliedFlagSettings: Settings | undefined;
	public lastQueryOptions: Options | undefined;
	public readonly receivedMessages: SDKUserMessage[] = [];

	public mockSessions: SDKSessionInfo[] = [];
	public mockSessionMessages: SessionMessage[] = [];
	public mockSubagentIds: string[] = [];
	public mockSubagentMessages: Map<string, SessionMessage[]> = new Map();

	/**
	 * Simulates the SDK failing to resume a session's transcript.
	 * - 'onResume': fail only when the query is launched with `resume` (the real
	 *   resume-miss); a subsequent `sessionId` (fresh) start succeeds. Models a
	 *   session that recovers.
	 * - 'always': fail on every start regardless of resume/sessionId. Models a
	 *   session where recovery itself keeps failing.
	 */
	public resumeMissMode: 'off' | 'onResume' | 'always' = 'off';

	public async query(options: {
		prompt: AsyncIterable<SDKUserMessage>;
		options: Options;
	}): Promise<Query> {
		this.queryCallCount++;
		this.lastQueryOptions = options.options;
		const shouldMiss = this.resumeMissMode === 'always'
			|| (this.resumeMissMode === 'onResume' && options.options.resume !== undefined);
		if (shouldMiss) {
			return this.createResumeMissQuery(options.prompt, options.options);
		}
		return this.createMockQuery(options.prompt);
	}

	public async listSessions(dir?: string): Promise<SDKSessionInfo[]> {
		return this.mockSessions;
	}

	public async getSessionInfo(sessionId: string, dir: string): Promise<SDKSessionInfo | undefined> {
		return this.mockSessions.find(s => s.sessionId === sessionId);
	}

	public async getSessionMessages(sessionId: string, dir: string): Promise<SessionMessage[]> {
		return this.mockSessionMessages;
	}

	public lastRenameSessionId: string | undefined;
	public lastRenameTitle: string | undefined;

	public async renameSession(sessionId: string, title: string): Promise<void> {
		this.lastRenameSessionId = sessionId;
		this.lastRenameTitle = title;
	}

	public lastForkSessionId: string | undefined;
	public lastForkOptions: ForkSessionOptions | undefined;

	public async forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult> {
		this.lastForkSessionId = sessionId;
		this.lastForkOptions = options;
		return { sessionId: 'forked-session-id' } as ForkSessionResult;
	}

	public async listSubagents(sessionId: string, options?: ListSubagentsOptions): Promise<string[]> {
		return this.mockSubagentIds;
	}

	public async getSubagentMessages(sessionId: string, agentId: string, options?: GetSubagentMessagesOptions): Promise<SessionMessage[]> {
		return this.mockSubagentMessages.get(agentId) ?? [];
	}

	private createMockQuery(prompt: AsyncIterable<SDKUserMessage>): Query {
		const generator = this.createMockGenerator(prompt);
		return {
			[Symbol.asyncIterator]: () => generator,
			setModel: async (modelId: string) => {
				this.setModelCallCount++;
				this.lastSetModel = modelId;
			},
			setPermissionMode: async (mode: string) => {
				this.setPermissionModeCallCount++;
				this.lastSetPermissionMode = mode;
			},
			applyFlagSettings: async (settings: Settings) => {
				this.applyFlagSettingsCallCount++;
				this.lastAppliedFlagSettings = settings;
			},
			abort: () => { /* no-op for mock */ },
		} as unknown as Query;
	}

	private createResumeMissQuery(prompt: AsyncIterable<SDKUserMessage>, options: Options): Query {
		const generator = this.createResumeMissGenerator(prompt, options);
		return {
			[Symbol.asyncIterator]: () => generator,
			setModel: async () => { /* no-op for mock */ },
			setPermissionMode: async () => { /* no-op for mock */ },
			applyFlagSettings: async () => { /* no-op for mock */ },
			abort: () => { /* no-op for mock */ },
		} as unknown as Query;
	}

	/**
	 * Emits the same signals the real Claude CLI produces when it cannot resume a
	 * session: the "No conversation found with session ID" line on stderr, followed
	 * by an `error_during_execution` result. The prompt is pulled first so that the
	 * session host has a current in-flight request (mirroring the real timing where
	 * the resume fails after the turn is under way).
	 */
	private async* createResumeMissGenerator(prompt: AsyncIterable<SDKUserMessage>, options: Options): AsyncGenerator<SDKAssistantMessage | SDKResultMessage, void, unknown> {
		for await (const msg of prompt) {
			this.receivedMessages.push(msg);
			const sessionId = options.resume ?? options.sessionId ?? 'unknown';
			options.stderr?.(`No conversation found with session ID: ${sessionId}`);
			yield {
				type: 'result',
				subtype: 'error_during_execution',
				uuid: 'mock-resume-miss-uuid',
				session_id: sessionId,
				duration_ms: 0,
				duration_api_ms: 0,
				is_error: true,
				num_turns: 0,
				total_cost_usd: 0,
				usage: { input_tokens: 0, output_tokens: 0 },
				permission_denials: [],
				errors: [`No conversation found with session ID: ${sessionId}`],
			} as unknown as SDKResultMessage;
			return;
		}
	}

	private async* createMockGenerator(prompt: AsyncIterable<SDKUserMessage>): AsyncGenerator<SDKAssistantMessage | SDKResultMessage, void, unknown> {
		// For every user message yielded, emit an assistant text and then a result
		for await (const msg of prompt) {
			this.receivedMessages.push(msg);
			yield {
				type: 'assistant',
				session_id: 'sess-1',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'Hello from mock!' }
					]
				}
			} as SDKAssistantMessage;
			yield {
				type: 'result',
				subtype: 'error_max_turns',
				uuid: 'mock-uuid',
				session_id: 'sess-1',
				duration_ms: 0,
				duration_api_ms: 0,
				is_error: false,
				num_turns: 0,
				total_cost_usd: 0,
				usage: { input_tokens: 0, output_tokens: 0 },
				permission_denials: []
			} as unknown as SDKResultMessage;
		}
	}
}
