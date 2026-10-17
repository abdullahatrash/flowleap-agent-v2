/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IMarkdownString } from '../../../../../../base/common/htmlContent.js';
import { isObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { basename } from '../../../../../../base/common/resources.js';
import { localize } from '../../../../../../nls.js';
import type { IMirroredActiveTurn, IMirroredChat } from '../../../../../../platform/agentHost/common/agentHostChatMirror.js';
import { toToolCallMeta } from '../../../../../../platform/agentHost/common/meta/agentToolCallMeta.js';
import { MessageKind, ResponsePartKind, ToolCallCancellationReason, ToolCallConfirmationReason, ToolCallStatus, ToolResultContentType, TurnState, type ErrorInfo, type ResponsePart, type ToolCallCompletedState, type ToolCallState, type ToolResultContent, type Turn } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { IChatToolInvocation, isLegacyChatTerminalToolInvocationData, ToolConfirmKind, type ConfirmedReason, type IChatTerminalToolInvocationData, type ILegacyChatTerminalToolInvocationData, type IChatContentInlineReference, type IChatContentReference, type IChatToolInvocationSerialized } from '../../../common/chatService/chatService.js';
import type { IChatModel, IChatProgressResponseContent, IChatRequestModel } from '../../../common/model/chatModel.js';
import { isToolResultInputOutputDetails } from '../../../common/tools/languageModelToolsService.js';

/**
 * How a local chat model becomes agent-host {@link Turn}s. One converter serves both callers so
 * that an imported conversation and a mirrored one read the same.
 */
export const enum ChatTurnConversion {
	/**
	 * A one-shot import into a new Agent Session: fresh part ids, every tool call completed,
	 * system-initiated requests folded into the preceding turn, and only the text-bearing part
	 * kinds (markdown, reasoning, inline references, tool calls).
	 */
	Import,
	/**
	 * The live editor chat mirror (PRD 0018 C1): part ids stable across updates
	 * (`<requestId>:<index>`), live tool-call states (pending confirmation, running), every
	 * response part kind at least as readable text, and turns hidden in the editor left out.
	 */
	Mirror,
}

/** Renders a chat message (plain string or markdown) as plain text. */
function stringifyChatMessage(message: string | IMarkdownString | undefined): string {
	if (message === undefined) {
		return '';
	}
	return typeof message === 'string' ? message : message.value;
}

/** Serializes a tool's raw input to a JSON string, tolerating non-serializable values. */
function stringifyToolInput(rawInput: unknown): string {
	if (typeof rawInput === 'string') {
		return rawInput;
	}
	try {
		return JSON.stringify(rawInput) ?? '';
	} catch {
		return '';
	}
}

/**
 * Renders an inline reference (a file/symbol chip interleaved with the response
 * text) as a markdown link so it survives migration instead of leaving a gap
 * where the chip used to be. Falls back to plain label text when no URI is
 * available.
 *
 * The source chip shows a short label — a file's basename or a symbol's name —
 * never a workspace-relative path. Some inline references carry that path in
 * their `name`, so a path-like label is collapsed to the URI's basename to
 * avoid leaking the tree into the imported transcript.
 */
function inlineReferenceToMarkdown(reference: IChatContentInlineReference['inlineReference'], name: string | undefined): string {
	let uri: URI | undefined;
	let label = name;
	let isSymbol = false;
	if (URI.isUri(reference)) {
		uri = reference;
	} else {
		// `Location` carries the URI directly; `IWorkspaceSymbol` nests it under
		// `location` and supplies its own display name.
		const location = reference as { uri?: URI; location?: { uri?: URI }; name?: string };
		if (URI.isUri(location.uri)) {
			uri = location.uri;
		} else if (URI.isUri(location.location?.uri)) {
			uri = location.location.uri;
			label = label ?? location.name;
			isSymbol = true;
		}
	}
	if (!uri) {
		return label ?? '';
	}
	// A file reference with a missing or path-like label (some carry the
	// workspace-relative path as their name) collapses to the basename, matching
	// the source chip. A symbol's name is preserved verbatim — it may legitimately
	// contain a separator (e.g. C++ `operator/`) and must not be treated as a path.
	if (!label || (!isSymbol && /[\\/]/.test(label))) {
		label = basename(uri);
	}
	return `[${label}](${uri.toString()})`;
}

/** A markdown link to a file, labelled with its basename. */
function fileLink(uri: URI): string {
	return `[${basename(uri)}](${uri.toString()})`;
}

/**
 * Maps a local chat tool invocation (live or serialized) to a completed
 * agent-host tool call, carrying its name, invocation messages, raw input and
 * textual result output. Failure is inferred from result details or a phase's terminal status.
 *
 * Sub-agent invocations (`toolSpecificData.kind === 'subagent'`) keep their
 * summary inline: the delegated prompt seeds the tool input and the sub-agent's
 * result text seeds the output when the generic result details carry neither.
 * The sub-agent's own turn-by-turn transcript lives in a separate worker chat
 * that has no backend counterpart after import, so only the summary is carried.
 * Phase presentations retain their textual output without a child-chat identity.
 */
function completedToolCall(part: IChatToolInvocation | IChatToolInvocationSerialized, toolCallId: string): ToolCallCompletedState {
	const invocationMessage = stringifyChatMessage(part.invocationMessage);
	const resultDetails = IChatToolInvocation.resultDetails(part);
	const subagentData = part.toolSpecificData?.kind === 'subagent' ? part.toolSpecificData : undefined;
	const phaseStatus = subagentData?.presentation === 'phase' ? subagentData.phaseStatus : undefined;

	let outputText = '';
	let isError = false;
	let resultInput: string | undefined;
	if (resultDetails && isToolResultInputOutputDetails(resultDetails)) {
		if (Array.isArray(resultDetails.output)) {
			for (const item of resultDetails.output) {
				if (item.type === 'embed' && item.isText) {
					outputText += item.value;
				}
			}
		}
		isError = !!resultDetails.isError;
		resultInput = resultDetails.input;
	}
	isError ||= phaseStatus === 'failed' || phaseStatus === 'cancelled';
	// Fall back to the sub-agent summary when the generic result details are empty.
	if (!outputText && subagentData?.result) {
		outputText = subagentData.result;
	}

	const toolInput = part.toolSpecificData?.kind === 'input'
		? stringifyToolInput(part.toolSpecificData.rawInput)
		: (resultInput ?? subagentData?.prompt ?? '');
	const content: ToolResultContent[] = [];
	if (outputText) {
		content.push({ type: ToolResultContentType.Text, text: outputText });
	}
	if (subagentData && subagentData.presentation !== 'phase') {
		// Preserve the sub-agent identity as structured content so it renders as a
		// sub-agent tool call (matching native sessions) and survives the events
		// round-trip — `buildSessionEventsFromTurns` emits a matching
		// `subagent.started` so a reload reconstructs the same name/description.
		content.push({
			type: ToolResultContentType.Subagent,
			resource: subagentData.chatResource ?? `agent-host-subagent:/${toolCallId}`,
			title: subagentData.agentName ?? localize('chat.importConversation.subagent', "Subagent"),
			...(subagentData.agentName ? { agentName: subagentData.agentName } : {}),
			...(subagentData.description ? { description: subagentData.description } : {}),
		});
	}
	const displayName = subagentData?.agentName || part.toolId;

	return {
		status: ToolCallStatus.Completed,
		toolCallId,
		toolName: part.toolId,
		displayName,
		invocationMessage: invocationMessage || stringifyChatMessage(subagentData?.description),
		toolInput,
		success: !isError,
		pastTenseMessage: stringifyChatMessage(part.pastTenseMessage) || invocationMessage,
		confirmed: ToolCallConfirmationReason.NotNeeded,
		...(content.length ? { content } : {}),
		...(isError ? {
			error: {
				message: outputText || localize('chat.importConversation.toolFailed', "Tool failed."),
				...(phaseStatus === 'cancelled' ? { code: 'cancelled' } : {}),
			}
		} : {}),
	};
}

function confirmationReason(reason: ConfirmedReason): ToolCallConfirmationReason {
	switch (reason.type) {
		case ToolConfirmKind.UserAction: return ToolCallConfirmationReason.UserAction;
		case ToolConfirmKind.Setting:
		case ToolConfirmKind.LmServicePerTool: return ToolCallConfirmationReason.Setting;
		default: return ToolCallConfirmationReason.NotNeeded;
	}
}

/** The command an editor terminal tool runs, as the chat view shows it; `undefined` for other tools. */
function terminalCommand(part: IChatToolInvocation | IChatToolInvocationSerialized): string | undefined {
	const data = terminalData(part);
	if (!data) {
		return undefined;
	}
	if (isLegacyChatTerminalToolInvocationData(data)) {
		return data.command;
	}
	const { forDisplay, toolEdited, userEdited, original } = data.commandLine;
	return forDisplay ?? toolEdited ?? userEdited ?? original;
}

function terminalData(part: IChatToolInvocation | IChatToolInvocationSerialized): IChatTerminalToolInvocationData | ILegacyChatTerminalToolInvocationData | undefined {
	return part.toolSpecificData?.kind === 'terminal' ? part.toolSpecificData : undefined;
}

/**
 * Marks an editor terminal tool as a terminal tool call (mirror only, PRD 0018 C3), as the agent
 * host's own agents do: `_meta.toolKind` and the command as the input. Without it a Viewer renders
 * the tool as a generic confirmation, which it hides once the tool completes. The command output
 * becomes the result text when the tool has none.
 */
function withTerminalKind(state: ToolCallState, part: IChatToolInvocation | IChatToolInvocationSerialized): ToolCallState {
	const command = terminalCommand(part);
	if (command === undefined || state.status === ToolCallStatus.Streaming) {
		return state;
	}
	const marked = { ...state, toolInput: JSON.stringify({ command }), _meta: { ...state._meta, ...toToolCallMeta({ toolKind: 'terminal' }) } };
	if (marked.status !== ToolCallStatus.Completed) {
		return marked;
	}
	const data = terminalData(part);
	const output = data && !isLegacyChatTerminalToolInvocationData(data) ? data.terminalCommandOutput?.text : undefined;
	if (!output || marked.content?.some(content => content.type === ToolResultContentType.Text)) {
		return marked;
	}
	return { ...marked, content: [...(marked.content ?? []), { type: ToolResultContentType.Text, text: output }] };
}

/**
 * Maps a tool invocation to its live agent-host state (mirror only). A tool that still streams
 * its input has no state yet. A result that waits for approval stays `running`: the Viewer cannot
 * approve a result (Remote Access v1), the editor user does.
 */
function liveToolCall(part: IChatToolInvocation | IChatToolInvocationSerialized, toolCallId: string): ToolCallState | undefined {
	const state = liveToolCallState(part, toolCallId);
	return state && withTerminalKind(state, part);
}

function liveToolCallState(part: IChatToolInvocation | IChatToolInvocationSerialized, toolCallId: string): ToolCallState | undefined {
	if (part.kind === 'toolInvocationSerialized') {
		return completedToolCall(part, toolCallId);
	}
	const base = {
		toolCallId,
		toolName: part.toolId,
		displayName: part.toolSpecificData?.kind === 'subagent' && part.toolSpecificData.agentName || part.toolId,
		invocationMessage: stringifyChatMessage(part.invocationMessage),
		toolInput: part.toolSpecificData?.kind === 'input' ? stringifyToolInput(part.toolSpecificData.rawInput) : '',
	};
	const state = part.state.get();
	switch (state.type) {
		case IChatToolInvocation.StateKind.Streaming:
			return undefined;
		case IChatToolInvocation.StateKind.WaitingForConfirmation:
			return {
				...base,
				status: ToolCallStatus.PendingConfirmation,
				confirmationTitle: stringifyChatMessage(state.confirmationMessages?.title) || base.invocationMessage,
			};
		case IChatToolInvocation.StateKind.Executing:
		case IChatToolInvocation.StateKind.WaitingForAuthentication:
		case IChatToolInvocation.StateKind.WaitingForPostApproval:
			return { ...base, status: ToolCallStatus.Running, confirmed: confirmationReason(state.confirmed) };
		case IChatToolInvocation.StateKind.Cancelled:
			return {
				...base,
				status: ToolCallStatus.Cancelled,
				reason: state.reason === ToolConfirmKind.Skipped ? ToolCallCancellationReason.Skipped : ToolCallCancellationReason.Denied,
				...(state.reasonMessage ? { reasonMessage: stringifyChatMessage(state.reasonMessage) } : {}),
			};
		case IChatToolInvocation.StateKind.Completed:
			return { ...completedToolCall(part, toolCallId), confirmed: confirmationReason(state.confirmed) };
	}
}

/**
 * The readable text of a part kind that has no protocol counterpart, for the mirror. Kinds that
 * only drive the editor UI (undo stops, code block URIs, buttons, progress lines) give nothing.
 */
function mirrorPlaceholder(part: IChatProgressResponseContent): string | undefined {
	switch (part.kind) {
		case 'markdownVuln':
		case 'info':
			return part.content.value;
		case 'warning':
			return localize('chatMirror.warning', "Warning: {0}", part.content.value);
		case 'progressTask':
		case 'progressTaskSerialized':
			return part.content.value;
		case 'textEditGroup':
		case 'notebookEditGroup':
		case 'externalEdit':
			return localize('chatMirror.editedFile', "Edited {0}", fileLink(part.uri));
		case 'workspaceEdit':
			return localize('chatMirror.editedFiles', "Edited {0} files", part.edits.length);
		case 'multiDiffData': {
			const data = isObservable(part.multiDiffData) ? part.multiDiffData.get() : part.multiDiffData;
			return localize('chatMirror.changedFiles', "Changed {0} files", data.resources.length);
		}
		case 'confirmation':
			return part.isUsed
				? localize('chatMirror.confirmationAnswered', "{0} (answered on the Host)", part.title)
				: localize('chatMirror.confirmationOpen', "{0}: answer this in FlowLeap on the Host.", part.title);
		case 'elicitation2':
		case 'elicitationSerialized':
			return localize('chatMirror.elicitation', "{0}: answer this in FlowLeap on the Host.", stringifyChatMessage(part.title));
		case 'questionCarousel':
			return part.isUsed
				? localize('chatMirror.questionsAnswered', "The Patent Agent asked questions (answered on the Host).")
				: localize('chatMirror.questionsOpen', "The Patent Agent asks questions: answer them in FlowLeap on the Host.");
		case 'planReview':
			return localize('chatMirror.planReview', "{0}: review the plan in FlowLeap on the Host.", part.title);
		default:
			return undefined;
	}
}

/** The response's used references as one markdown line (mirror only, once the response is complete). */
function referencesMarkdown(references: ReadonlyArray<IChatContentReference>): string | undefined {
	const links: string[] = [];
	for (const { reference } of references) {
		const location = typeof reference === 'object' && !URI.isUri(reference) ? reference as { uri?: unknown } : undefined;
		const uri = URI.isUri(reference) ? reference : URI.isUri(location?.uri) ? location.uri : undefined;
		if (uri) {
			links.push(fileLink(uri));
		}
	}
	return links.length ? localize('chatMirror.references', "Used references: {0}", links.join(', ')) : undefined;
}

/**
 * Collects a request's response stream into agent-host {@link ResponsePart}s, in stream order:
 * markdown parts become {@link ResponsePartKind.Markdown}, reasoning parts become
 * {@link ResponsePartKind.Reasoning}, inline references become markdown links, and tool
 * invocations become {@link ResponsePartKind.ToolCall} parts. The mirror also renders every other
 * part kind it can as markdown text (see {@link mirrorPlaceholder}).
 */
function responsePartsFromRequest(request: IChatRequestModel, conversion: ChatTurnConversion): ResponsePart[] {
	const responseParts: ResponsePart[] = [];
	const response = request.response;
	if (!response) {
		return responseParts;
	}
	const mirror = conversion === ChatTurnConversion.Mirror;
	const partId = (index: number | string) => mirror ? `${request.id}:${index}` : generateUuid();
	response.entireResponse.value.forEach((part, index) => {
		if (part.kind === 'markdownContent') {
			const content = part.content.value;
			if (content) {
				responseParts.push({ kind: ResponsePartKind.Markdown, id: partId(index), content });
			}
		} else if (part.kind === 'thinking') {
			const content = Array.isArray(part.value) ? part.value.join('') : (part.value ?? '');
			if (content) {
				responseParts.push({ kind: ResponsePartKind.Reasoning, id: partId(index), content });
			}
		} else if (part.kind === 'inlineReference') {
			// A file/symbol chip interleaved with the response text; render it
			// as a markdown link so it survives instead of leaving a gap.
			const content = inlineReferenceToMarkdown(part.inlineReference, part.name);
			if (content) {
				responseParts.push({ kind: ResponsePartKind.Markdown, id: partId(index), content });
			}
		} else if (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') {
			const toolCallId = part.toolCallId || partId(index);
			const toolCall = mirror ? liveToolCall(part, toolCallId) : completedToolCall(part, toolCallId);
			if (toolCall) {
				responseParts.push({ kind: ResponsePartKind.ToolCall, toolCall });
			}
		} else if (mirror) {
			const content = mirrorPlaceholder(part);
			if (content) {
				responseParts.push({ kind: ResponsePartKind.Markdown, id: partId(index), content });
			}
		}
		// The import carries the text-bearing kinds only.
	});
	if (mirror && response.isComplete) {
		const content = referencesMarkdown(response.contentReferences);
		if (content) {
			responseParts.push({ kind: ResponsePartKind.Markdown, id: partId('references'), content });
		}
	}
	return responseParts;
}

/**
 * Derives how a turn ended from its source response: a cancelled response maps
 * to {@link TurnState.Cancelled}, a response carrying error details maps to
 * {@link TurnState.Error} (with the message/code surfaced as {@link ErrorInfo}),
 * and anything else is {@link TurnState.Complete}.
 */
function turnOutcomeFromRequest(request: IChatRequestModel): { state: TurnState; error?: ErrorInfo } {
	const response = request.response;
	if (!response) {
		return { state: TurnState.Complete };
	}
	if (response.isCanceled) {
		return { state: TurnState.Cancelled };
	}
	const errorDetails = response.result?.errorDetails;
	if (errorDetails) {
		return {
			state: TurnState.Error,
			error: { errorType: errorDetails.code ?? 'error', message: errorDetails.message },
		};
	}
	return { state: TurnState.Complete };
}

/** The user message of a request. A system-initiated request in the mirror is the agent's own. */
function turnMessage(request: IChatRequestModel, conversion: ChatTurnConversion): Turn['message'] {
	const kind = conversion === ChatTurnConversion.Mirror && request.isSystemInitiated ? MessageKind.Agent : MessageKind.User;
	return { text: request.message.text, origin: { kind } };
}

/**
 * Translates requests of a local {@link IChatModel} into agent-host {@link Turn}s.
 *
 * Each request becomes a turn whose response stream is mapped by
 * {@link responsePartsFromRequest} and whose end state is mapped by
 * {@link turnOutcomeFromRequest}. On import, system-initiated requests (e.g. background
 * terminal-completion notifications that were auto-sent back to the agent) are not real user
 * turns, so their synthetic message is dropped and their response (and end state) is folded into
 * the preceding turn as a continuation. The mirror cannot change a turn it already published, so
 * there such a request is a turn of its own with an agent message.
 */
function turnsFromRequests(requests: readonly IChatRequestModel[], conversion: ChatTurnConversion): Turn[] {
	const turns: Turn[] = [];
	for (const request of requests) {
		const responseParts = responsePartsFromRequest(request, conversion);
		const outcome = turnOutcomeFromRequest(request);
		if (outcome.error) {
			responseParts.push({ kind: ResponsePartKind.Error, error: outcome.error });
		}
		if (request.isSystemInitiated && conversion === ChatTurnConversion.Import) {
			// Not a genuine user message; append its output to the previous
			// turn so the agent's continued work is preserved without surfacing
			// the injected notification as an editable user turn. The
			// continuation is what actually ended the exchange, so its outcome
			// supersedes the previous turn's.
			const previous = turns[turns.length - 1];
			if (previous) {
				previous.responseParts.push(...responseParts);
				previous.state = outcome.state;
			}
			continue;
		}
		turns.push({
			id: conversion === ChatTurnConversion.Mirror ? request.id : generateUuid(),
			message: turnMessage(request, conversion),
			responseParts,
			usage: undefined,
			state: outcome.state,
		} satisfies Turn);
	}
	return turns;
}

/**
 * Translates a local {@link IChatModel} into agent-host {@link Turn}s suitable
 * for {@link IAgentHostService.createSession}'s `importConversation` option.
 */
export function importedTurnsFromChatModel(model: IChatModel): Turn[] {
	return turnsFromRequests(model.getRequests(), ChatTurnConversion.Import);
}

/** Whether the request still runs: its response has not completed. */
export function isActiveChatRequest(request: IChatRequestModel): boolean {
	return !!request.response && !request.response.isComplete;
}

/** The requests of a chat that the mirror shows, in order: turns hidden in the editor stay out. */
export function mirroredRequests(model: IChatModel): IChatRequestModel[] {
	return model.getRequests().filter(request => !request.isHiddenFromTranscript);
}

/** Maps one finished request to its mirrored turn. */
export function mirroredTurnFromRequest(request: IChatRequestModel): Turn {
	return turnsFromRequests([request], ChatTurnConversion.Mirror)[0];
}

/** Maps the running request to the mirror's active turn. */
export function mirroredActiveTurnFromRequest(request: IChatRequestModel): IMirroredActiveTurn {
	return {
		turnId: request.id,
		startedAt: request.timestamp,
		message: turnMessage(request, ChatTurnConversion.Mirror),
		responseParts: responsePartsFromRequest(request, ChatTurnConversion.Mirror),
	};
}

/** The full mirrored state of a chat: its finished turns and the request that runs now. */
export function mirroredChatFromModel(id: string, model: IChatModel): IMirroredChat {
	const finished: IChatRequestModel[] = [];
	let activeTurn: IMirroredActiveTurn | undefined;
	for (const request of mirroredRequests(model)) {
		if (isActiveChatRequest(request)) {
			activeTurn = mirroredActiveTurnFromRequest(request);
		} else {
			finished.push(request);
		}
	}
	return { id, turns: turnsFromRequests(finished, ChatTurnConversion.Mirror), ...(activeTurn ? { activeTurn } : {}) };
}
