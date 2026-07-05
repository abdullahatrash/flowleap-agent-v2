/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getResourceEditorComments, getSessionEditorComments, groupNearbySessionEditorComments, hasAcceptedAgentFeedbackComments, SessionEditorCommentSource } from '../../browser/sessionEditorComments.js';
import { AgentFeedbackKind, AgentFeedbackState } from '../../browser/agentFeedbackService.js';

suite('SessionEditorComments', () => {
	const session = URI.parse('test://session/1');
	const fileA = URI.parse('file:///a.ts');
	const fileB = URI.parse('file:///b.ts');

	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups nearby comments only within the same resource', () => {
		const comments = getSessionEditorComments(session, [
			{ id: 'feedback-a', text: 'feedback a', resourceUri: fileA, range: new Range(10, 1, 10, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Accepted },
			{ id: 'feedback-a2', text: 'feedback a2', resourceUri: fileA, range: new Range(13, 1, 13, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Accepted },
			{ id: 'feedback-b', text: 'feedback b', resourceUri: fileB, range: new Range(11, 1, 11, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Accepted },
		]);

		const groups = groupNearbySessionEditorComments(comments, 5);
		assert.strictEqual(groups.length, 2);
		assert.deepStrictEqual(groups[0].map(comment => `${comment.resourceUri.path}:${comment.range.startLineNumber}:${comment.source}`), [
			'/a.ts:10:agentFeedback',
			'/a.ts:13:agentFeedback',
		]);
		assert.deepStrictEqual(groups[1].map(comment => `${comment.resourceUri.path}:${comment.range.startLineNumber}:${comment.source}`), [
			'/b.ts:11:agentFeedback',
		]);
	});

	test('filters resource comments and detects authored feedback presence', () => {
		const comments = getSessionEditorComments(session, [
			{ id: 'feedback-a', text: 'feedback a', resourceUri: fileA, range: new Range(1, 1, 1, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Accepted },
			{ id: 'feedback-b', text: 'feedback b', resourceUri: fileB, range: new Range(2, 1, 2, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Accepted },
		]);

		assert.strictEqual(hasAcceptedAgentFeedbackComments(comments), true);
		assert.deepStrictEqual(getResourceEditorComments(fileA, comments).map(comment => comment.source), [SessionEditorCommentSource.AgentFeedback]);
		assert.deepStrictEqual(getResourceEditorComments(fileB, comments).map(comment => comment.source), [SessionEditorCommentSource.AgentFeedback]);
	});

	test('excludes resolved feedback from the editor comments', () => {
		const comments = getSessionEditorComments(session, [
			{ id: 'feedback-accepted', text: 'accepted', resourceUri: fileA, range: new Range(2, 1, 2, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Accepted },
			{ id: 'feedback-resolved', text: 'resolved', resourceUri: fileA, range: new Range(4, 1, 4, 1), sessionResource: session, kind: AgentFeedbackKind.UserReview, state: AgentFeedbackState.Resolved },
		]);

		assert.deepStrictEqual(comments.map(comment => comment.sourceId), ['feedback-accepted']);
	});
});
