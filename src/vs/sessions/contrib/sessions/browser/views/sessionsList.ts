/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/sessionsList.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { pauseCSSAnimationsWhenHidden } from '../../../../../base/browser/animationSync.js';
import { Gesture } from '../../../../../base/browser/touch.js';
import { IListVirtualDelegate, ListDragOverEffectPosition, ListDragOverEffectType, NotSelectableGroupId } from '../../../../../base/browser/ui/list/list.js';
import { IListStyles } from '../../../../../base/browser/ui/list/listWidget.js';
import { IObjectTreeElement, ITreeNode, ITreeRenderer, ITreeContextMenuEvent, ObjectTreeElementCollapseState, ITreeDragAndDrop, ITreeDragOverReaction } from '../../../../../base/browser/ui/tree/tree.js';
import { RenderIndentGuides, TreeFindMode } from '../../../../../base/browser/ui/tree/abstractTree.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { HighlightedLabel } from '../../../../../base/browser/ui/highlightedlabel/highlightedLabel.js';
import { createMatches, FuzzyScore, IMatch } from '../../../../../base/common/filters.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { IObservable, IReader, ISettableObservable, autorun, derived, observableSignalFromEvent, observableValue } from '../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { fromNow } from '../../../../../base/common/date.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { localize } from '../../../../../nls.js';
import { MenuId, IMenuService, MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { MenuWorkbenchToolBar } from '../../../../../platform/actions/browser/toolbar.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { MarshalledId } from '../../../../../base/common/marshallingIds.js';
import { SessionProviderIdContext, SessionSupportsDeleteContext, SessionSupportsRenameContext, SessionTypeContext, IsPhoneLayoutContext, SessionIsArchivedContext, SessionIsReadContext } from '../../../../common/contextkeys.js';
import { IContextMenuService, IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { WorkbenchObjectTree } from '../../../../../platform/list/browser/listService.js';
import { IStyleOverride, defaultButtonStyles, defaultFindWidgetStyles, defaultInputBoxStyles, defaultToggleStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { GITHUB_REMOTE_FILE_SCHEME, ISession, ISessionWorkspace, SessionStatus } from '../../../../services/sessions/common/session.js';
import { AgentSessionApprovalModel, IAgentSessionApprovalInfo } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionApprovalModel.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { ActionRunner, IAction, Separator, SubmenuAction, toAction } from '../../../../../base/common/actions.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { HoverStyle } from '../../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { ISessionsManagementService, IActiveSession } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { ISessionsListModelService, SessionSortMode } from '../../../../services/sessions/browser/sessionsListModelService.js';
import { ISessionGroup, ISessionGroupsService } from '../../../../services/sessions/browser/sessionGroupsService.js';
import { ISessionSectionOrderService } from '../../../../services/sessions/browser/sessionSectionOrderService.js';
import { InputBox, MessageType } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IWorkbenchAssignmentService } from '../../../../../workbench/services/assignment/common/assignmentService.js';
// =============================================================================
// TEMPORARY (tracked by https://github.com/microsoft/vscode/issues/320480)
// -----------------------------------------------------------------------------
// `IAgentSessionsService` is a Copilot-provider internal and must normally only
// be consumed by the Copilot chat sessions provider — the rest of the Agents
// window stays provider-agnostic (see SESSIONS.md). This single, deliberate
// exception lets the sessions list trigger lazy resolution of expensive session
// properties (e.g. changes) for rows that scroll into view, until Don
// re-implements it the right way (driven from inside the Copilot provider, or
// via a provider-agnostic visibility signal on the shared services).
// DO NOT add further usages of this import in the sessions workbench, and DO NOT
// copy this suppression elsewhere.
// =============================================================================
// eslint-disable-next-line no-restricted-imports
import { IAgentSessionsService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';
import { LocalSelectionTransfer } from '../../../../../platform/dnd/browser/dnd.js';
import { DraggedSessionIdentifier, SessionsDataTransfers } from '../../../../browser/dnd.js';
import { IDragAndDropData } from '../../../../../base/browser/dnd.js';
import { ElementsDragAndDropData, ListViewTargetSector } from '../../../../../base/browser/ui/list/listView.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { buildSessionHoverContent, getSessionDiffStats } from '../sessionHoverContent.js';
import { SessionStatusIcon } from '../../../../browser/sessionStatusIcon.js';

const $ = DOM.$;

const SESSION_SECTION_FOCUS_FROM_POINTER_CLASS = 'session-section-focus-from-pointer';
const SESSION_HEADER_DROP_TARGET_CLASS = 'session-header-drop-target';

export const SessionItemToolbarMenuId = new MenuId('SessionItemToolbar');
export const SessionItemContextMenuId = MenuId.SessionItemContextMenu;
export const SessionSectionToolbarMenuId = new MenuId('SessionSectionToolbar');
export const SessionGroupToolbarMenuId = new MenuId('SessionGroupToolbar');
export const IsSessionPinnedContext = new RawContextKey<boolean>('sessionItem.isPinned', false);
export const SessionItemHasBranchNameContext = new RawContextKey<boolean>('sessionItem.hasBranchName', false);
/** Whether the focused session item currently belongs to a user group. */
export const SessionItemInGroupContext = new RawContextKey<boolean>('sessionItem.inGroup', false);
export const SessionSectionTypeContext = new RawContextKey<string>('sessionSection.type', '');

/**
 * Controls whether a collapsed section or group header shows an indicator for
 * the sessions hidden inside it. Registered in `sessions.contribution.ts`.
 */
export const SESSIONS_LIST_SHOW_UNREAD_IN_COLLAPSED_SECTIONS_SETTING = 'sessions.list.showUnreadInCollapsedSections';

//#region Types

export enum SessionsGrouping {
	Workspace = 'workspace',
	Date = 'date',
}

export enum SessionsSorting {
	Created = 'created',
	Updated = 'updated',
}

function sortingToMode(sorting: SessionsSorting): SessionSortMode {
	return sorting === SessionsSorting.Updated ? 'updated' : 'created';
}

/** Fallback spacing (ms) used when assigning synthetic sort keys past an open boundary. */
const SORT_FALLBACK_STEP_MS = 60_000;

export interface ISessionSection {
	readonly id: string;
	readonly label: string;
	readonly sessions: ISession[];
}

/**
 * A user-created group rendered as a section-like header. Carries the backing
 * {@link ISessionGroup} plus its currently-visible member sessions and whether
 * the header should render its inline name editor.
 */
export interface ISessionGroupItem {
	readonly group: ISessionGroup;
	readonly sessions: ISession[];
	readonly editing: boolean;
}

export interface ISessionShowMore {
	readonly showMore: true;
	readonly kind: 'sessions' | 'folders';
	readonly mode: 'more' | 'less';
	readonly sectionId: string;
	readonly sectionLabel: string;
	readonly remainingCount: number;
}

export type SessionListItem = ISession | ISessionSection | ISessionGroupItem | ISessionShowMore;

function isSessionGroupItem(item: SessionListItem): item is ISessionGroupItem {
	return 'group' in item;
}

function isSessionSection(item: SessionListItem): item is ISessionSection {
	return !isSessionGroupItem(item) && 'sessions' in item && Array.isArray((item as ISessionSection).sessions);
}

function isSessionShowMore(item: SessionListItem): item is ISessionShowMore {
	return 'showMore' in item && (item as ISessionShowMore).showMore === true;
}

function isSessionItem(item: SessionListItem): item is ISession {
	return !isSessionGroupItem(item) && !isSessionSection(item) && !isSessionShowMore(item);
}

const SHOW_MORE_FOLDERS_LABEL = '__more_folders__';
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
/**
 * Vertical gap reserved between session rows so each row reads as its own inset
 * card. Reserved by the delegate rather than taken from the row's own box, so the
 * row keeps its full content height. Paired with the `.session-list-row-spacing`
 * rules in `sessionsList.css`.
 */
const INSET_ROW_GAP = 2;

/** Marks the rows the inset row-spacing rules apply to. */
const SESSION_LIST_INSET_ROW_CLASS = 'session-list-inset-row';

/** Shown for a session waiting on the user when its provider sent no message. */
const INPUT_NEEDED_FALLBACK_LABEL = localize('needsInput', "Input needed");

//#endregion

//#region Tree Delegate

class SessionsTreeDelegate implements IListVirtualDelegate<SessionListItem> {
	private static readonly ITEM_HEIGHT = 54;
	/** Compact rows are title-only — see the `.sessions-list-control.compact` rules in `sessionsList.css`. */
	private static readonly ITEM_HEIGHT_COMPACT = 28;
	/**
	 * Extra height a compact row reserves for the needs-input callout, which
	 * stands in for the details row a compact row does not have.
	 */
	private static readonly INPUT_NEEDED_ROW_HEIGHT = 32;
	/**
	 * Phone layout uses a taller row so the inline action toolbar can
	 * meet the 44px minimum touch target without overflowing. Sized to
	 * fit a 44px toolbar centered between the title and details rows.
	 * Keep in sync with the `.phone-layout .session-item` rules in
	 * `sessionsList.css`.
	 */
	private static readonly ITEM_HEIGHT_PHONE = 76;
	private static readonly SECTION_HEIGHT = 26;
	private static readonly SHOW_MORE_HEIGHT = 26;

	constructor(
		private readonly _approvalModel: AgentSessionApprovalModel | undefined,
		private readonly _isPhone: () => boolean,
		private readonly _isCompact: () => boolean = () => false,
		private readonly _useInsetRowSpacing = false,
	) { }

	private withInsetRowSpacing(height: number): number {
		return height + (this._useInsetRowSpacing ? INSET_ROW_GAP : 0);
	}

	getHeight(element: SessionListItem): number {
		if (isSessionSection(element) || isSessionGroupItem(element)) {
			return SessionsTreeDelegate.SECTION_HEIGHT;
		}
		if (isSessionShowMore(element)) {
			return this.withInsetRowSpacing(SessionsTreeDelegate.SHOW_MORE_HEIGHT);
		}

		const session = element as ISession;
		let height: number;
		if (this._isPhone()) {
			height = SessionsTreeDelegate.ITEM_HEIGHT_PHONE;
		} else if (this._isCompact()) {
			height = SessionsTreeDelegate.ITEM_HEIGHT_COMPACT;
		} else {
			height = SessionsTreeDelegate.ITEM_HEIGHT;
		}
		let approval: IAgentSessionApprovalInfo | undefined;
		if (this._approvalModel) {
			approval = getFirstApprovalAcrossChats(this._approvalModel, session, undefined);
			if (approval) {
				height += SessionItemRenderer.getApprovalRowHeight(approval.label);
			}
		}
		// A compact row drops the details row, so a session waiting on the user
		// would otherwise say nothing about it. A real approval already says it.
		if (!approval && this._isCompact() && session.status.get() === SessionStatus.NeedsInput) {
			height += SessionsTreeDelegate.INPUT_NEEDED_ROW_HEIGHT;
		}
		return this.withInsetRowSpacing(height);
	}

	hasDynamicHeight(element: SessionListItem): boolean {
		return isSessionItem(element) && (!!this._approvalModel || this._isCompact());
	}

	getTemplateId(element: SessionListItem): string {
		if (isSessionGroupItem(element)) {
			return SessionGroupRenderer.TEMPLATE_ID;
		}
		if (isSessionSection(element)) {
			return SessionSectionRenderer.TEMPLATE_ID;
		}
		if (isSessionShowMore(element)) {
			return SessionShowMoreRenderer.TEMPLATE_ID;
		}
		return SessionItemRenderer.TEMPLATE_ID;
	}
}

//#endregion

//#region Session Item Renderer

/**
 * Resolves the inline toolbar action context to the current multi-selection so
 * that session item actions (e.g. Restore) operate on all selected sessions
 * when the clicked session is part of the selection, and on just the clicked
 * session otherwise.
 */
class SessionItemActionRunner extends ActionRunner {

	constructor(private readonly getMultiSelectedSessions: (session: ISession) => ISession[]) {
		super();
	}

	protected override async runAction(action: IAction, context?: unknown): Promise<void> {
		if (context && !Array.isArray(context)) {
			await super.runAction(action, this.getMultiSelectedSessions(context as ISession));
			return;
		}
		await super.runAction(action, context);
	}
}

// Keyframes name of the session title shimmer (see `@keyframes session-title-shimmer`
// in sessionsList.css). Used to pause the shimmer while the row is not visible.
const SESSION_TITLE_SHIMMER_ANIMATION_NAMES = new Set(['session-title-shimmer']);
const SESSION_TITLE_SHIMMER_PAUSED_CLASS = 'session-title-shimmer-paused';

/** Renames a session. Registered in `sessionsViewActions.ts`. */
export const RENAME_SESSION_COMMAND_ID = 'sessionsViewPane.renameSession';

/**
 * The in-progress value of an inline rename, kept outside the row template so a
 * draft survives the tree re-rendering (or recycling) the row underneath it.
 */
interface IInlineRenameValueState {
	readonly initialValue: string;
	value: string;
}

/**
 * Renders a row-local title editor into `container` and drives its commit/cancel
 * lifecycle. `onFinish` receives the new title (or `undefined` when nothing
 * should change) and whether the caller should move focus back to the list —
 * `false` when the editor lost focus to somewhere else and stealing it back
 * would fight the user.
 */
function renderInlineRenameInput(
	container: HTMLElement,
	contextViewService: IContextViewService,
	state: IInlineRenameValueState,
	ariaLabel: string,
	disposables: DisposableStore,
	onFinish: (title: string | undefined, restoreListFocus: boolean) => void,
): InputBox {
	DOM.clearNode(container);
	const input = new InputBox(container, contextViewService, {
		inputBoxStyles: defaultInputBoxStyles,
		ariaLabel,
		validationOptions: {
			validation: value => value.trim()
				? null
				: { content: localize('inlineRename.empty', "Title cannot be empty"), type: MessageType.ERROR },
		},
	});
	disposables.add(toDisposable(() => {
		input.hideMessage();
		input.dispose();
	}));
	input.value = state.value;
	input.focus();
	input.select();

	let done = false;
	const finish = (commit: boolean, restoreListFocus: boolean) => {
		if (done) {
			return;
		}
		const title = input.value.trim();
		if (commit && !title) {
			if (restoreListFocus) {
				// Deliberate Enter on an empty title: keep the editor open and let
				// the input box show and announce the validation message.
				input.validate();
				input.focus();
				return;
			}
			// Blurred while empty — treat it as a cancel rather than nag.
			commit = false;
		}

		done = true;
		input.hideMessage();
		onFinish(commit && title !== state.initialValue.trim() ? title : undefined, restoreListFocus);
	};

	disposables.add(DOM.addDisposableListener(input.inputElement, DOM.EventType.INPUT, () => state.value = input.value));
	disposables.add(DOM.addStandardDisposableListener(input.inputElement, DOM.EventType.KEY_DOWN, event => {
		if (event.equals(KeyCode.Enter)) {
			event.preventDefault();
			event.stopPropagation();
			finish(true, true);
		} else if (event.equals(KeyCode.Escape)) {
			event.preventDefault();
			event.stopPropagation();
			finish(false, true);
		}
	}));
	disposables.add(DOM.addDisposableListener(input.inputElement, DOM.EventType.BLUR, () => finish(true, false)));
	disposables.add(toDisposable(() => DOM.clearNode(container)));
	return input;
}

interface ISessionItemTemplate {
	readonly container: HTMLElement;
	readonly statusIcon: SessionStatusIcon;
	readonly title: HighlightedLabel;
	readonly titleRow: HTMLElement;
	readonly titleContainer: HTMLElement;
	readonly titleInputContainer: HTMLElement;
	readonly titleToolbar: MenuWorkbenchToolBar;
	/**
	 * Carries the context a compact row moves off the row and onto its hover:
	 * revealed on hover/focus by the `.sessions-list-control.compact` rules.
	 */
	readonly compactHoverDescription: HTMLElement;
	readonly detailsRow: HTMLElement;
	readonly approvalRow: HTMLElement;
	readonly approvalLabel: HTMLElement;
	readonly approvalButtonContainer: HTMLElement;
	readonly inputNeededRow: HTMLElement;
	readonly inputNeededLabel: HTMLElement;
	readonly contextKeyService: IContextKeyService;
	readonly disposables: DisposableStore;
	readonly elementDisposables: DisposableStore;
}

class SessionItemRenderer implements ITreeRenderer<SessionListItem, FuzzyScore, ISessionItemTemplate> {
	static readonly TEMPLATE_ID = 'session-item';
	readonly templateId = SessionItemRenderer.TEMPLATE_ID;
	readonly rowClassName = SESSION_LIST_INSET_ROW_CLASS;

	private static readonly APPROVAL_ROW_MAX_LINES = 3;
	private static readonly _APPROVAL_ROW_LINE_HEIGHT = 18;
	private static readonly _APPROVAL_ROW_OVERHEAD = 14;

	static getApprovalRowHeight(label: string): number {
		const lineCount = Math.min(label.split(/\r?\n/).length, SessionItemRenderer.APPROVAL_ROW_MAX_LINES);
		return lineCount * SessionItemRenderer._APPROVAL_ROW_LINE_HEIGHT + SessionItemRenderer._APPROVAL_ROW_OVERHEAD;
	}

	private readonly _onDidChangeItemHeight = new Emitter<ISession>();
	readonly onDidChangeItemHeight: Event<ISession> = this._onDidChangeItemHeight.event;

	/** The session whose row currently hosts the inline rename editor, if any. */
	private readonly editingSession = observableValue<ISession | undefined>(this, undefined);
	private activeRenameInput: { readonly session: ISession; readonly input: InputBox } | undefined;
	private renameState: (IInlineRenameValueState & { readonly session: ISession }) | undefined;

	constructor(
		private readonly options: { grouping: () => SessionsGrouping; sorting: () => SessionsSorting; isPinned: (session: ISession) => boolean; isRead: (session: ISession) => boolean; compact: () => boolean; visibleSessions: IObservable<readonly (IActiveSession | undefined)[]>; getMultiSelectedSessions: (session: ISession) => ISession[]; inlineRename: boolean; contextViewService?: IContextViewService; onDidDoubleClickRename?: (session: ISession) => void; onDidFinishRename?: () => void },
		private readonly approvalModel: AgentSessionApprovalModel | undefined,
		private readonly instantiationService: IInstantiationService,
		private readonly contextKeyService: IContextKeyService,
		private readonly markdownRendererService: IMarkdownRendererService,
		private readonly hoverService: IHoverService,
		private readonly sessionsProvidersService: ISessionsProvidersService,
		// TEMPORARY — see the note on the `IAgentSessionsService` import above (#320480).
		private readonly agentSessionsService: IAgentSessionsService,
		private readonly sessionsManagementService: ISessionsManagementService,
	) {
	}

	renderTemplate(container: HTMLElement): ISessionItemTemplate {
		const disposables = new DisposableStore();
		const elementDisposables = disposables.add(new DisposableStore());

		container.classList.add('session-item');

		const iconContainer = DOM.append(container, $('.session-icon'));
		const statusIcon = disposables.add(this.instantiationService.createInstance(SessionStatusIcon, iconContainer));
		const mainCol = DOM.append(container, $('.session-main'));
		const titleRow = DOM.append(mainCol, $('.session-title-row'));
		const titleContainer = DOM.append(titleRow, $('.session-title'));
		const title = disposables.add(new HighlightedLabel(titleContainer));
		disposables.add(pauseCSSAnimationsWhenHidden(titleContainer, {
			pausedClass: SESSION_TITLE_SHIMMER_PAUSED_CLASS,
			animationNames: SESSION_TITLE_SHIMMER_ANIMATION_NAMES,
		}));
		// Host for the inline rename editor. It lives beside the static title and
		// swaps in via the `renaming` class on the row (see sessionsList.css), so
		// the row keeps its height and the title's place in the layout.
		const titleInputContainer = DOM.append(titleRow, $('.session-title-input.session-inline-rename-input'));
		for (const eventType of ['pointerdown', 'pointerup', 'click', 'dblclick'] as const) {
			disposables.add(DOM.addDisposableListener(titleInputContainer, eventType, e => e.stopPropagation()));
		}
		disposables.add(Gesture.ignoreTarget(titleInputContainer));
		const compactHoverDescription = DOM.append(titleRow, $('.session-compact-hover-description'));
		const titleToolbarContainer = DOM.append(titleRow, $('.session-title-toolbar'));
		// The list opens a session on click and on Gesture `tap` (touch).
		// DOM event propagation stops only cover mouse/pointer events; the
		// list's tap handler reads from `Gesture` directly, bypassing
		// bubbling. Combine both: stop pointer/click for mouse, and
		// register the toolbar with `Gesture.ignoreTarget` so synthesized
		// tap events on touch never reach the list either.
		for (const eventType of ['pointerdown', 'pointerup', 'click', 'dblclick'] as const) {
			disposables.add(DOM.addDisposableListener(titleToolbarContainer, eventType, e => e.stopPropagation()));
		}
		disposables.add(Gesture.ignoreTarget(titleToolbarContainer));
		const detailsRow = DOM.append(mainCol, $('.session-details-row'));

		// Approval row
		const approvalRow = DOM.append(mainCol, $('.session-approval-row'));
		const approvalLabel = DOM.append(approvalRow, $('span.session-approval-label'));
		const approvalButtonContainer = DOM.append(approvalRow, $('.session-approval-button'));

		// Needs-input callout for compact rows, which have no details row to carry
		// the status. Styled as an approval row without a button, and hidden from
		// screen readers because the accessible label already names the state.
		const inputNeededRow = DOM.append(mainCol, $('.session-input-needed-row.session-approval-row'));
		inputNeededRow.setAttribute('aria-hidden', 'true');
		const inputNeededLabel = DOM.append(inputNeededRow, $('span.session-input-needed-label'));

		const contextKeyService = disposables.add(this.contextKeyService.createScoped(container));
		const scopedInstantiationService = disposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService])));
		const actionRunner = disposables.add(new SessionItemActionRunner(this.options.getMultiSelectedSessions));
		const titleToolbar = disposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, titleToolbarContainer, SessionItemToolbarMenuId, {
			menuOptions: { shouldForwardArgs: true },
			actionRunner,
		}));

		return { container, statusIcon, title, titleRow, titleContainer, titleInputContainer, titleToolbar, compactHoverDescription, detailsRow, approvalRow, approvalLabel, approvalButtonContainer, inputNeededRow, inputNeededLabel, contextKeyService, disposables, elementDisposables };
	}

	renderElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: ISessionItemTemplate): void {
		const element = node.element;
		if (!isSessionItem(element)) {
			return;
		}
		this.renderSession(element, template, createMatches(node.filterData));
	}

	private renderSession(element: ISession, template: ISessionItemTemplate, matches?: IMatch[]): void {
		template.elementDisposables.clear();
		template.elementDisposables.add(toDisposable(() => template.container.classList.remove('renaming')));

		if (this.options.inlineRename) {
			template.elementDisposables.add(DOM.addDisposableListener(template.titleRow, DOM.EventType.DBLCLICK, (event: MouseEvent) => {
				if (
					event.button !== 0 ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey ||
					!element.capabilities.supportsRename
				) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				if (this.beginRename(element)) {
					this.options.onDidDoubleClickRename?.(element);
				}
			}));
			template.elementDisposables.add(autorun(reader => {
				const editingSession = this.editingSession.read(reader);
				const editing = !!editingSession && isEqual(editingSession.resource, element.resource);
				template.container.classList.toggle('renaming', editing);
				if (editing) {
					this.renderRenameInput(element, template, reader.store);
				}
			}));
		}

		// TEMPORARY (#320480): trigger lazy resolve of expensive session
		// properties (e.g. changes) for rows that scroll into view, so providers
		// that populate them on demand deliver fresh data by the time the row
		// renders. This reaches into a Copilot-provider internal and must be
		// moved into the provider — see the note on the import above.
		this.agentSessionsService.model.observeSession(element.resource);

		// Rich hover on the row showing folder, branch, diff stats and provider.
		// Shown to the right of the row, similar to the extensions list.
		template.elementDisposables.add(this.hoverService.setupDelayedHover(template.container, () => ({
			content: buildSessionHoverContent(element, this.sessionsProvidersService, this.options.compact()),
			appearance: { showPointer: true },
			position: { hoverPosition: HoverPosition.RIGHT, forcePosition: true },
			persistence: { hideOnHover: false },
		}), { groupId: 'sessions-list' }));

		// Toolbar context
		template.titleToolbar.context = element;

		// Context keys
		const isPinned = this.options.isPinned(element);
		IsSessionPinnedContext.bindTo(template.contextKeyService).set(isPinned);
		SessionIsArchivedContext.bindTo(template.contextKeyService).set(element.isArchived.get());
		SessionIsReadContext.bindTo(template.contextKeyService).set(this.options.isRead(element));
		SessionItemHasBranchNameContext.bindTo(template.contextKeyService).set(!!element.workspace.get()?.folders[0]?.gitRepository?.branchName?.trim());

		// Pinned & archived styling — reactive
		template.elementDisposables.add(autorun(reader => {
			const isArchived = element.isArchived.read(reader);
			template.container.classList.toggle('archived', isArchived);
			// Only apply pinned styling when not archived to avoid persistent toolbars on archived sessions
			template.container.classList.toggle('pinned', isPinned && !isArchived);
		}));

		// Sticky styling — reactive on the wrapper's sticky observable
		template.elementDisposables.add(autorun(reader => {
			const wrapper = this.options.visibleSessions.read(reader).find(s => s?.sessionId === element.sessionId);
			const isSticky = wrapper ? wrapper.sticky.read(reader) : false;
			template.container.classList.toggle('sticky', isSticky);
		}));

		// Icon — reactive based on status, read state, PR, and motion preference.
		// The current icon CSS selector is stored on the template (not a local
		// variable) so it survives across renderSession calls — the tree re-renders
		// all visible rows on every splice, which clears elementDisposables and
		// recreates the autorun. Without template-level tracking, the selector
		// resets to undefined and the DOM is rebuilt every time, restarting the
		// CSS spin animation.
		template.elementDisposables.add(autorun(reader => {
			const sessionStatus = element.status.read(reader);
			const isRead = this.options.isRead(element);
			const isArchived = element.isArchived.read(reader);

			// The status icon (spinner vs. codicon, cross-fade, reduced-motion) is fully
			// owned by the SessionStatusIcon widget; here we just feed it the latest state.
			// Row recycling re-feeds the widget, which cross-fades to the new session's icon.
			template.statusIcon.setStatus(sessionStatus, isRead, isArchived);
			template.container.classList.toggle('in-progress', sessionStatus === SessionStatus.InProgress);
			template.container.classList.toggle('needs-input', sessionStatus === SessionStatus.NeedsInput);
			template.container.classList.toggle('unread', !isRead && !isArchived);
		}));

		// Title — reactive
		template.elementDisposables.add(autorun(reader => {
			const titleText = element.title.read(reader);
			template.title.set(titleText, matches);
		}));

		// Details row — reactive: badge · diff stats · time
		const timeDisposable = template.elementDisposables.add(new MutableDisposable());
		const descriptionDisposable = template.elementDisposables.add(new MutableDisposable());
		template.elementDisposables.add(autorun(reader => {
			const sessionStatus = element.status.read(reader);
			const diffStats = getSessionDiffStats(element, reader);
			const workspace = element.workspace.read(reader);
			const description = element.description.read(reader);
			let timeDate: Date | undefined;

			// When the session is InProgress or NeedsInput, hide workspace/diff/time details in this row
			const hideDetails = sessionStatus === SessionStatus.InProgress || sessionStatus === SessionStatus.NeedsInput;

			if (!hideDetails) {
				timeDate = this.options.sorting() === SessionsSorting.Updated ? element.updatedAt.read(reader) : element.createdAt;
			}
			// Clear and rebuild details row
			DOM.clearNode(template.detailsRow);
			DOM.clearNode(template.compactHoverDescription);

			// Workspace badge — shown when not grouped by workspace, or when the
			// session is pinned/archived (their section headers don't carry the
			// workspace name). Resolved before the compact branch because a compact
			// row shows it on hover instead of in the details row.
			const workspaceBadgeLabel = workspace && (
				this.options.grouping() !== SessionsGrouping.Workspace ||
				this.options.isPinned(element) ||
				element.isArchived.read(reader)
			)
				? this.getWorkspaceBadgeLabel(workspace)
				: undefined;

			// A compact row is title-only at rest. The workspace moves to the hover
			// slot, and the diff, status and time are carried by the row's hover.
			if (this.options.compact()) {
				descriptionDisposable.clear();
				timeDisposable.clear();
				if (workspaceBadgeLabel) {
					DOM.append(template.compactHoverDescription, $('span.session-badge', undefined, workspaceBadgeLabel));
				}
				return;
			}

			const parts: HTMLElement[] = [];

			if (sessionStatus !== SessionStatus.InProgress) {
				const isWorkspaceSession = workspace &&
					workspace.folders.length > 0 &&
					workspace?.folders[0]?.gitRepository?.workTreeUri === undefined;
				const icon = workspace?.isVirtualWorkspace ? Codicon.cloudCompact : isWorkspaceSession ? Codicon.folderCompact : Codicon.worktreeCompact;
				const typeIconEl = DOM.append(template.detailsRow, $('span.session-details-icon'));
				DOM.append(typeIconEl, $(`span${ThemeIcon.asCSSSelector(icon)}`));
				parts.push(typeIconEl);
			}

			if (!hideDetails && workspaceBadgeLabel) {
				const badgeEl = DOM.append(template.detailsRow, $('span.session-badge'));
				badgeEl.textContent = workspaceBadgeLabel;
				parts.push(badgeEl);
			}

			// Diff stats, from the same summary-first reader the pill and the hover use
			if (!hideDetails && diffStats) {
				if (parts.length > 0) {
					DOM.append(template.detailsRow, $('span.session-separator.has-separator'));
				}
				const diffEl = DOM.append(template.detailsRow, $('span.session-diff'));
				DOM.append(diffEl, $('span.session-diff-added')).textContent = `+${diffStats.insertions}`;
				DOM.append(diffEl, $('span.session-diff-removed')).textContent = `-${diffStats.deletions}`;
				parts.push(diffEl);
			}

			// Status description
			if (sessionStatus === SessionStatus.InProgress) {
				if (parts.length > 0) {
					DOM.append(template.detailsRow, $('span.session-separator.has-separator'));
				}
				const statusEl = DOM.append(template.detailsRow, $('span.session-description'));
				if (description) {
					descriptionDisposable.value = this.markdownRendererService.render(description, { sanitizerConfig: { replaceWithPlaintext: true } }, statusEl);
				} else {
					descriptionDisposable.clear();
					statusEl.textContent = localize('working', "Working...");
				}
				parts.push(statusEl);
			} else if (sessionStatus === SessionStatus.NeedsInput) {
				if (parts.length > 0) {
					DOM.append(template.detailsRow, $('span.session-separator.has-separator'));
				}
				const statusEl = DOM.append(template.detailsRow, $('span.session-description'));
				if (description) {
					descriptionDisposable.value = this.markdownRendererService.render(description, { sanitizerConfig: { replaceWithPlaintext: true } }, statusEl);
				} else {
					descriptionDisposable.clear();
					statusEl.textContent = INPUT_NEEDED_FALLBACK_LABEL;
				}
				parts.push(statusEl);
			} else if (sessionStatus === SessionStatus.Error) {
				if (parts.length > 0) {
					DOM.append(template.detailsRow, $('span.session-separator.has-separator'));
				}
				const statusEl = DOM.append(template.detailsRow, $('span.session-description'));
				if (description) {
					descriptionDisposable.value = this.markdownRendererService.render(description, { sanitizerConfig: { replaceWithPlaintext: true } }, statusEl);
				} else {
					descriptionDisposable.clear();
					statusEl.textContent = localize('failed', "Failed");
				}
				parts.push(statusEl);
			} else {
				descriptionDisposable.clear();
			}

			// Timestamp — visible when not hiding details
			if (!hideDetails && timeDate) {
				if (parts.length > 0) {
					DOM.append(template.detailsRow, $('span.session-separator.has-separator'));
				}
				const timeEl = DOM.append(template.detailsRow, $('span.session-time'));
				const definiteTimeDate = timeDate;
				const formatTime = () => {
					const seconds = Math.round((Date.now() - definiteTimeDate.getTime()) / 1000);
					return seconds < 60 ? localize('secondsDuration', "now") : fromNow(definiteTimeDate, true);
				};
				timeEl.textContent = formatTime();
				const targetWindow = DOM.getWindow(timeEl);
				const interval = targetWindow.setInterval(() => {
					timeEl.textContent = formatTime();
				}, 60_000);
				timeDisposable.value = toDisposable(() => targetWindow.clearInterval(interval));
			} else {
				timeDisposable.clear();
			}
		}));

		// Approval row — reactive
		if (this.approvalModel) {
			this.renderApprovalRow(element, template);
		}

		this.renderCompactInputNeededRow(element, template);
	}

	/**
	 * Compact rows carry no details row, so a session waiting on the user would
	 * say nothing about it. Render the provider's message (or a fallback) as a
	 * callout, and only when no real approval is already occupying that space.
	 */
	private renderCompactInputNeededRow(element: ISession, template: ISessionItemTemplate): void {
		const contentStore = template.elementDisposables.add(new DisposableStore());

		const isVisible = (reader: IReader | undefined): boolean =>
			this.options.compact()
			&& element.status.read(reader) === SessionStatus.NeedsInput
			&& !(this.approvalModel && getFirstApprovalAcrossChats(this.approvalModel, element, reader));

		let wasVisible = isVisible(undefined);
		template.inputNeededRow.classList.toggle('visible', wasVisible);

		template.elementDisposables.add(autorun(reader => {
			contentStore.clear();
			const visible = isVisible(reader);
			template.inputNeededRow.classList.toggle('visible', visible);
			template.inputNeededLabel.textContent = '';

			if (visible) {
				const description = element.description.read(reader);
				if (description) {
					contentStore.add(this.markdownRendererService.render(description, { sanitizerConfig: { replaceWithPlaintext: true } }, template.inputNeededLabel));
				} else {
					template.inputNeededLabel.textContent = INPUT_NEEDED_FALLBACK_LABEL;
				}
			}

			// The callout occupies its own line, so its arrival and departure change
			// the reserved row height — mirrors the approval row's height signal.
			if (visible !== wasVisible) {
				wasVisible = visible;
				this._onDidChangeItemHeight.fire(element);
			}
		}));
	}

	private renderApprovalRow(element: ISession, template: ISessionItemTemplate): void {
		if (!this.approvalModel) {
			return;
		}

		const approvalModel = this.approvalModel;
		const initialInfo = getFirstApprovalAcrossChats(approvalModel, element, undefined);
		let lastApprovalHeight = approvalRowHeightFor(initialInfo);
		template.approvalRow.classList.toggle('visible', lastApprovalHeight > 0);

		const buttonStore = template.elementDisposables.add(new DisposableStore());

		template.elementDisposables.add(autorun(reader => {
			buttonStore.clear();

			const info = getFirstApprovalAcrossChats(approvalModel, element, reader);
			const visible = !!info;

			template.approvalRow.classList.toggle('visible', visible);

			if (info) {
				// Render up to 3 lines as separate code blocks
				const lines = info.label.split('\n');
				const maxLines = SessionItemRenderer.APPROVAL_ROW_MAX_LINES;
				const visibleLines = lines.slice(0, maxLines);
				if (lines.length > maxLines) {
					visibleLines[maxLines - 1] = `${visibleLines[maxLines - 1]} \u2026`;
				}
				const langId = info.languageId ?? 'json';
				const labelContent = new MarkdownString();
				for (const line of visibleLines) {
					labelContent.appendCodeblock(langId, line);
				}

				template.approvalLabel.textContent = '';
				buttonStore.add(this.markdownRendererService.render(labelContent, {}, template.approvalLabel));

				// Hover with full content as a code block
				const fullContent = new MarkdownString().appendCodeblock(info.languageId ?? 'json', info.label);
				buttonStore.add(this.hoverService.setupDelayedHover(template.approvalLabel, {
					content: fullContent,
					style: HoverStyle.Pointer,
					position: { hoverPosition: HoverPosition.BELOW },
				}));

				template.approvalButtonContainer.textContent = '';
				const button = buttonStore.add(new Button(template.approvalButtonContainer, {
					title: localize('allowActionOnce', "Allow once"),
					// Every visible "Allow" button carries the same label and tooltip,
					// so name the action each one approves or a screen-reader user
					// cannot tell them apart.
					ariaLabel: localize('allowActionAria', "Allow: {0}", info.label),
					secondary: true,
					...defaultButtonStyles
				}));
				button.label = localize('allowAction', "Allow");
				buttonStore.add(button.onDidClick(() => info.confirm()));
			}

			// Fire on any height change, not just on visibility: the model can
			// replace one pending approval with another whose label spans a
			// different number of lines, which changes the reserved row height.
			const height = approvalRowHeightFor(info);
			if (height !== lastApprovalHeight) {
				lastApprovalHeight = height;
				this._onDidChangeItemHeight.fire(element);
			}
		}));
	}

	private getWorkspaceBadgeLabel(workspace: ISessionWorkspace): string | undefined {
		// For GitHub remote sessions, extract owner/name from the repository URI path
		const folder = workspace.folders[0];
		if (folder?.root.scheme === GITHUB_REMOTE_FILE_SCHEME) {
			const parts = folder.root.path.split('/').filter(Boolean);
			if (parts.length >= 2) {
				return `${parts[0]}/${parts[1]}`;
			}
		}

		return workspace.label;
	}

	/**
	 * Opens the inline rename editor on `session`'s row. Returns `false` when the
	 * session cannot be renamed, so callers can fall back to another affordance.
	 */
	beginRename(session: ISession): boolean {
		const target = this.resolveRenameTarget(session);
		if (!target) {
			return false;
		}
		// Already editing this row: a second F2 or double-click just re-focuses the
		// editor rather than discarding what the user has typed so far.
		if (this.activeRenameInput && isEqual(this.activeRenameInput.session.resource, target.resource)) {
			this.activeRenameInput.input.focus();
			this.activeRenameInput.input.select();
			return true;
		}
		if (!this.renameState || !isEqual(this.renameState.session.resource, target.resource)) {
			const initialValue = target.title.get();
			this.renameState = { session: target, initialValue, value: initialValue };
		}
		this.editingSession.set(target, undefined);
		return true;
	}

	private renderRenameInput(session: ISession, template: ISessionItemTemplate, disposables: DisposableStore): void {
		const renameState = this.renameState;
		if (!renameState || !isEqual(renameState.session.resource, session.resource)) {
			return;
		}
		if (!this.options.contextViewService) {
			throw new Error('Inline rename requires a context view service');
		}
		const input = renderInlineRenameInput(
			template.titleInputContainer,
			this.options.contextViewService,
			renameState,
			localize('renameSession.inputAriaLabel', "Rename session. Press Enter to confirm or Escape to cancel."),
			disposables,
			(title, restoreListFocus) => {
				this.editingSession.set(undefined, undefined);
				this.renameState = undefined;
				if (restoreListFocus) {
					this.options.onDidFinishRename?.();
				}
				// Re-resolve: the session may have gone away while the editor was open.
				const target = this.resolveRenameTarget(session);
				if (title && target) {
					this.sessionsManagementService.renameSession(target, title).catch(onUnexpectedError);
				}
			},
		);
		this.activeRenameInput = { session, input };
		disposables.add(toDisposable(() => {
			if (this.activeRenameInput?.input === input) {
				this.activeRenameInput = undefined;
			}
		}));
	}

	private resolveRenameTarget(session: ISession): ISession | undefined {
		if (!this.options.inlineRename) {
			return undefined;
		}
		const target = this.sessionsManagementService.getSessions().find(candidate => isEqual(candidate.resource, session.resource));
		return target?.capabilities.supportsRename ? target : undefined;
	}

	disposeElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: ISessionItemTemplate): void {
		// Drop a rename draft whose session has disappeared, so the editor does not
		// reappear on whichever row the tree recycles this template for.
		if (isSessionItem(node.element) && this.renameState && isEqual(this.renameState.session.resource, node.element.resource) && !this.resolveRenameTarget(node.element)) {
			this.editingSession.set(undefined, undefined);
			this.renameState = undefined;
		}
		template.elementDisposables.clear();
	}

	disposeTemplate(template: ISessionItemTemplate): void {
		template.disposables.dispose();
	}
}

//#endregion

//#region Section Header Renderer

/**
 * The parts every header row (section and group) shares so the collapsed-state
 * indicator can be rendered by one helper for both.
 */
interface ISessionHeaderTemplate {
	/** Leading slot that carries the collapsed-state indicator. */
	readonly icon: HTMLElement;
	/** Whether the header is currently collapsible *and* collapsed. */
	readonly collapsed: ISettableObservable<boolean>;
	readonly elementDisposables: DisposableStore;
}

/**
 * What a collapsed header should signal about the sessions it hides. Ordered by
 * priority: a session waiting on the user outranks merely unread output.
 */
export const enum SessionHeaderStatus {
	NeedsInput,
	Unread,
}

export function getSessionHeaderStatus(sessions: readonly ISession[], reader: IReader): SessionHeaderStatus | undefined {
	let hasUnread = false;
	for (const session of sessions) {
		if (session.isArchived.read(reader)) {
			continue;
		}
		if (session.status.read(reader) === SessionStatus.NeedsInput) {
			return SessionHeaderStatus.NeedsInput;
		}
		hasUnread ||= !session.isRead.read(reader);
	}
	return hasUnread ? SessionHeaderStatus.Unread : undefined;
}

/**
 * Renders a header's leading icon: the collapsed-state indicator when the
 * header is collapsed and something inside it wants attention, otherwise the
 * header's own static icon (if it has one), otherwise nothing.
 */
function renderSessionHeaderIcon(template: ISessionHeaderTemplate, sessions: readonly ISession[], icon: ThemeIcon | undefined, showUnreadInCollapsedSections: IObservable<boolean>, instantiationService: IInstantiationService): void {
	const headerStatus = derived(reader => template.collapsed.read(reader) && showUnreadInCollapsedSections.read(reader)
		? getSessionHeaderStatus(sessions, reader)
		: undefined);
	template.elementDisposables.add(autorun(reader => {
		const status = headerStatus.read(reader);
		DOM.clearNode(template.icon);
		template.icon.className = 'session-section-icon';
		template.icon.style.display = status !== undefined || icon ? '' : 'none';
		if (status !== undefined) {
			const statusIcon = reader.store.add(instantiationService.createInstance(SessionStatusIcon, template.icon));
			statusIcon.setStatus(
				status === SessionHeaderStatus.NeedsInput ? SessionStatus.NeedsInput : SessionStatus.Completed,
				status !== SessionHeaderStatus.Unread,
				false,
			);
		} else if (icon) {
			template.icon.classList.add(...ThemeIcon.asClassNameArray(icon));
		}
	}));
}

interface ISessionSectionTemplate extends ISessionHeaderTemplate {
	readonly container: HTMLElement;
	readonly label: HTMLElement;
	readonly count: HTMLElement;
	readonly toolbar: MenuWorkbenchToolBar;
	readonly chevron: HTMLElement;
	readonly contextKeyService: IContextKeyService;
	readonly disposables: DisposableStore;
}

class SessionSectionRenderer implements ITreeRenderer<SessionListItem, FuzzyScore, ISessionSectionTemplate> {
	static readonly TEMPLATE_ID = 'session-section';
	readonly templateId = SessionSectionRenderer.TEMPLATE_ID;

	private readonly templatesByElement = new WeakMap<ISessionSection, ISessionSectionTemplate>();
	private readonly templatesById = new Map<string, ISessionSectionTemplate>();

	constructor(
		private readonly hideSectionCount: boolean,
		private readonly showUnreadInCollapsedSections: IObservable<boolean>,
		private readonly instantiationService: IInstantiationService,
		private readonly contextKeyService: IContextKeyService,
	) { }

	renderTemplate(container: HTMLElement): ISessionSectionTemplate {
		const disposables = new DisposableStore();

		container.classList.add('session-section');
		const icon = DOM.append(container, $('span.session-section-icon'));
		icon.setAttribute('aria-hidden', 'true');
		icon.style.display = 'none';
		const label = DOM.append(container, $('span.session-section-label'));
		const count = DOM.append(container, $('span.session-section-count'));
		const toolbarContainer = DOM.append(container, $('.session-section-toolbar'));
		const chevron = DOM.append(container, $('span.session-section-chevron'));
		chevron.setAttribute('aria-hidden', 'true');

		const contextKeyService = disposables.add(this.contextKeyService.createScoped(container));
		const scopedInstantiationService = disposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService])));
		const toolbar = disposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, toolbarContainer, SessionSectionToolbarMenuId, {
			menuOptions: { shouldForwardArgs: true },
		}));

		return { container, icon, collapsed: observableValue(this, false), label, count, toolbar, chevron, contextKeyService, disposables, elementDisposables: disposables.add(new DisposableStore()) };
	}

	renderElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: ISessionSectionTemplate): void {
		const element = node.element;
		if (!isSessionSection(element)) {
			return;
		}
		template.elementDisposables.clear();
		this.templatesByElement.set(element, template);
		this.templatesById.set(element.id, template);
		template.container.classList.remove(SESSION_HEADER_DROP_TARGET_CLASS);
		template.label.textContent = element.label;
		if (this.hideSectionCount) {
			template.count.textContent = '';
			template.count.style.display = 'none';
		} else {
			template.count.textContent = String(element.sessions.length);
			template.count.style.display = '';
		}

		// Establishes `template.collapsed`, which the header icon reads, so it has
		// to run before `renderSessionHeaderIcon`.
		this.updateChevron(template, node.collapsible, node.collapsed);
		renderSessionHeaderIcon(template, element.sessions, undefined, this.showUnreadInCollapsedSections, this.instantiationService);

		// Set context key for section type so toolbar actions can use when clauses
		const sectionType = element.id.startsWith('workspace:') ? 'workspace' : element.id;
		SessionSectionTypeContext.bindTo(template.contextKeyService).set(sectionType);
		template.toolbar.context = element;
	}

	/**
	 * Updates the leading indicator and the expand/collapse chevron for an
	 * already-rendered section. The tree only re-invokes `renderTwistie` (not
	 * `renderElement`) when a section's collapse state toggles, so the owning
	 * list forwards collapse changes here.
	 */
	updateCollapseState(element: ISessionSection, collapsed: boolean): void {
		const template = this.templatesByElement.get(element);
		if (template) {
			this.updateChevron(template, true, collapsed);
		}
	}

	setDropTarget(sectionId: string, active: boolean): void {
		const template = this.templatesById.get(sectionId);
		template?.container.classList.toggle(SESSION_HEADER_DROP_TARGET_CLASS, active);
	}

	private updateChevron(template: ISessionSectionTemplate, collapsible: boolean, collapsed: boolean): void {
		template.collapsed.set(collapsible && collapsed, undefined);
		template.chevron.className = 'session-section-chevron';
		if (collapsible) {
			template.chevron.classList.add('collapsible');
			const icon = collapsed ? Codicon.chevronRight : Codicon.chevronDown;
			template.chevron.classList.add(...ThemeIcon.asClassNameArray(icon));
		}
	}

	disposeElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: ISessionSectionTemplate): void {
		if (isSessionSection(node.element)) {
			this.templatesByElement.delete(node.element);
			this.templatesById.delete(node.element.id);
		}
		template.elementDisposables.clear();
	}

	disposeTemplate(template: ISessionSectionTemplate): void {
		template.disposables.dispose();
	}
}

//#endregion

//#region Session Group Renderer

interface ISessionGroupTemplate extends ISessionHeaderTemplate {
	readonly container: HTMLElement;
	readonly label: HTMLElement;
	readonly inputContainer: HTMLElement;
	readonly toolbar: MenuWorkbenchToolBar;
	readonly chevron: HTMLElement;
	readonly contextKeyService: IContextKeyService;
	readonly disposables: DisposableStore;
}

/**
 * Callbacks the group renderer uses to commit or cancel inline renaming.
 */
interface ISessionGroupRendererDelegate {
	commitEdit(group: ISessionGroup, name: string): void;
	cancelEdit(group: ISessionGroup): void;
}

class SessionGroupRenderer implements ITreeRenderer<SessionListItem, FuzzyScore, ISessionGroupTemplate> {
	static readonly TEMPLATE_ID = 'session-group';
	readonly templateId = SessionGroupRenderer.TEMPLATE_ID;

	private readonly templatesByElement = new WeakMap<ISessionGroupItem, ISessionGroupTemplate>();
	private readonly templatesById = new Map<string, ISessionGroupTemplate>();

	constructor(
		private readonly delegate: ISessionGroupRendererDelegate,
		private readonly showUnreadInCollapsedSections: IObservable<boolean>,
		private readonly instantiationService: IInstantiationService,
		private readonly contextKeyService: IContextKeyService,
	) { }

	renderTemplate(container: HTMLElement): ISessionGroupTemplate {
		const disposables = new DisposableStore();

		container.classList.add('session-section', 'session-group');
		const icon = DOM.append(container, $('span.session-section-icon'));
		icon.setAttribute('aria-hidden', 'true');
		icon.style.display = 'none';
		const label = DOM.append(container, $('span.session-section-label'));
		const inputContainer = DOM.append(container, $('.session-group-input'));
		const toolbarContainer = DOM.append(container, $('.session-section-toolbar'));
		const chevron = DOM.append(container, $('span.session-section-chevron'));
		chevron.setAttribute('aria-hidden', 'true');

		const contextKeyService = disposables.add(this.contextKeyService.createScoped(container));
		const scopedInstantiationService = disposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService])));
		const toolbar = disposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, toolbarContainer, SessionGroupToolbarMenuId, {
			menuOptions: { shouldForwardArgs: true },
		}));

		return { container, icon, collapsed: observableValue(this, false), label, inputContainer, toolbar, chevron, contextKeyService, disposables, elementDisposables: disposables.add(new DisposableStore()) };
	}

	renderElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: ISessionGroupTemplate): void {
		const element = node.element;
		if (!isSessionGroupItem(element)) {
			return;
		}
		template.elementDisposables.clear();
		this.templatesByElement.set(element, template);
		this.templatesById.set(element.group.id, template);
		template.container.classList.remove(SESSION_HEADER_DROP_TARGET_CLASS);

		template.label.textContent = element.group.name;
		// Establishes `template.collapsed`, which the header icon reads, so it has
		// to run before `renderSessionHeaderIcon`.
		this.updateChevron(template, node.collapsible, node.collapsed);
		renderSessionHeaderIcon(template, element.sessions, undefined, this.showUnreadInCollapsedSections, this.instantiationService);
		template.toolbar.context = element;

		template.container.classList.toggle('session-group-editing', element.editing);
		if (element.editing) {
			this.renderInput(element, template);
		} else {
			template.inputContainer.style.display = 'none';
			template.label.style.display = '';
		}
	}

	private renderInput(element: ISessionGroupItem, template: ISessionGroupTemplate): void {
		template.label.style.display = 'none';
		template.inputContainer.style.display = '';
		DOM.clearNode(template.inputContainer);

		const input = template.elementDisposables.add(new InputBox(template.inputContainer, undefined, {
			inputBoxStyles: defaultInputBoxStyles,
			ariaLabel: localize('sessionGroupName', "Group name"),
		}));
		input.value = element.group.name;
		input.focus();
		input.select();

		let done = false;
		const commit = () => {
			if (done) {
				return;
			}
			done = true;
			this.delegate.commitEdit(element.group, input.value.trim());
		};
		const cancel = () => {
			if (done) {
				return;
			}
			done = true;
			this.delegate.cancelEdit(element.group);
		};

		template.elementDisposables.add(DOM.addStandardDisposableListener(input.inputElement, DOM.EventType.KEY_DOWN, e => {
			if (e.equals(KeyCode.Enter)) {
				e.preventDefault();
				e.stopPropagation();
				commit();
			} else if (e.equals(KeyCode.Escape)) {
				e.preventDefault();
				e.stopPropagation();
				cancel();
			}
		}));
		template.elementDisposables.add(DOM.addDisposableListener(input.inputElement, DOM.EventType.BLUR, () => commit()));
	}

	/**
	 * Forwarded from the owning list when the group's collapse state toggles, so
	 * the leading indicator and the chevron both follow it.
	 */
	updateCollapseState(element: ISessionGroupItem, collapsed: boolean): void {
		const template = this.templatesByElement.get(element);
		if (template) {
			this.updateChevron(template, true, collapsed);
		}
	}

	setDropTarget(groupId: string, active: boolean): void {
		const template = this.templatesById.get(groupId);
		template?.container.classList.toggle(SESSION_HEADER_DROP_TARGET_CLASS, active);
	}

	private updateChevron(template: ISessionGroupTemplate, collapsible: boolean, collapsed: boolean): void {
		template.collapsed.set(collapsible && collapsed, undefined);
		template.chevron.className = 'session-section-chevron';
		if (collapsible) {
			template.chevron.classList.add('collapsible');
			const icon = collapsed ? Codicon.chevronRight : Codicon.chevronDown;
			template.chevron.classList.add(...ThemeIcon.asClassNameArray(icon));
		}
	}

	disposeElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: ISessionGroupTemplate): void {
		if (isSessionGroupItem(node.element)) {
			this.templatesByElement.delete(node.element);
			this.templatesById.delete(node.element.group.id);
		}
		template.elementDisposables.clear();
	}

	disposeTemplate(template: ISessionGroupTemplate): void {
		template.disposables.dispose();
	}
}

//#endregion

//#region Show More Renderer

class SessionShowMoreRenderer implements ITreeRenderer<SessionListItem, FuzzyScore, HTMLElement> {
	static readonly TEMPLATE_ID = 'session-show-more';
	readonly templateId = SessionShowMoreRenderer.TEMPLATE_ID;
	readonly rowClassName = SESSION_LIST_INSET_ROW_CLASS;

	renderTemplate(container: HTMLElement): HTMLElement {
		container.classList.add('session-show-more');
		return DOM.append(container, $('span.session-show-more-label'));
	}

	renderElement(node: ITreeNode<SessionListItem, FuzzyScore>, _index: number, template: HTMLElement): void {
		const element = node.element;
		if (!isSessionShowMore(element)) {
			return;
		}
		const container = template.parentElement;
		container?.classList.toggle('session-show-more-folders', element.kind === 'folders');
		if (element.mode === 'less') {
			template.textContent = element.kind === 'folders'
				? localize('showLessWorkspacesCompact', "Show fewer workspaces")
				: localize('showLessCompact', "Show less");
		} else {
			template.textContent = element.kind === 'folders'
				? element.remainingCount === 1
					? localize('showMoreWorkspaceCompact', "+{0} more workspace", element.remainingCount)
					: localize('showMoreWorkspacesCompact', "+{0} more workspaces", element.remainingCount)
				: localize('showMoreCompact', "+{0} more", element.remainingCount);
		}
	}

	disposeTemplate(_template: HTMLElement): void { }
}

//#region Accessibility

interface ISessionsAccessibilityProviderOptions {
	readonly showUnreadInCollapsedSections: IObservable<boolean>;
}

class SessionsAccessibilityProvider {

	constructor(private readonly options: ISessionsAccessibilityProviderOptions) { }

	getWidgetAriaLabel(): string {
		return localize('sessionsList', "Sessions");
	}

	getAriaLabel(element: SessionListItem): string | IObservable<string> | null {
		if (isSessionGroupItem(element)) {
			return this.getSectionAriaLabel(element.group.name, element.sessions);
		}
		if (isSessionSection(element)) {
			return this.getSectionAriaLabel(element.label, element.sessions);
		}
		if (isSessionShowMore(element)) {
			if (element.mode === 'less') {
				return element.kind === 'folders'
					? localize('showLessWorkspacesAria', "Show fewer workspaces")
					: localize('showLessAria', "Show fewer sessions");
			}
			return element.kind === 'folders'
				? element.remainingCount === 1
					? localize('showMoreWorkspaceAria', "Show {0} more workspace", element.remainingCount)
					: localize('showMoreWorkspacesAria', "Show {0} more workspaces", element.remainingCount)
				: localize('showMoreAria', "Show {0} more sessions", element.remainingCount);
		}
		const title = element.title.get();
		const created = fromNow(element.createdAt, true);
		return localize('sessionItemAria', "{0}, created {1}", title, created);
	}

	/**
	 * A header announces what a collapsed section hides, so a screen-reader user
	 * gets the same signal the leading indicator gives a sighted user.
	 */
	private getSectionAriaLabel(label: string, sessions: readonly ISession[]): IObservable<string> {
		return derived(this, reader => {
			const status = this.options.showUnreadInCollapsedSections.read(reader) ? getSessionHeaderStatus(sessions, reader) : undefined;
			switch (status) {
				case SessionHeaderStatus.NeedsInput:
					return localize('sessionSectionNeedsInputAria', "{0}, {1}, session needs input", label, sessions.length);
				case SessionHeaderStatus.Unread:
					return localize('sessionSectionUnreadAria', "{0}, {1}, contains unread sessions", label, sessions.length);
				default:
					return localize('sessionSectionAria', "{0}, {1}", label, sessions.length);
			}
		});
	}
}

//#endregion

//#region Drag and Drop

/**
 * Callbacks the sessions list provides to its drag-and-drop controller so the
 * controller can validate and apply manual reordering without owning the list
 * model itself.
 */
interface ISessionsListDndDelegate {
	/** Whether a session may participate in reordering within its current section. */
	isReorderable(session: ISession): boolean;
	/** Whether a session currently renders in the Pinned section. */
	isSessionPinned(session: ISession): boolean;
	/** Whether the dragged sessions may be reordered relative to the given target. */
	canDropOn(dragged: ISession[], target: ISession): boolean;
	/** Apply the reorder, placing the dragged sessions before/after the target. */
	reorder(dragged: ISession[], target: ISession, position: 'before' | 'after'): void;
	/** The id of the group the session belongs to, or `undefined`. */
	getGroupIdOfSession(session: ISession): string | undefined;
	/** Add the given sessions to the group. */
	addSessionsToGroup(sessions: ISession[], groupId: string, target: ISession | undefined, position: 'before' | 'after' | undefined): void;
	/** Pin the given sessions, optionally placing them before/after a pinned target. */
	pinSessions(sessions: ISession[], target: ISession | undefined, position: 'before' | 'after' | undefined): void;
	/** Highlight only the header that will receive the dragged sessions. */
	setDropTargetHeader(header: ISessionDropTargetHeader | undefined): void;
	/** Reorder a top-level header (group or workspace section) before/after another. */
	reorderSection(draggedId: string, targetId: string, position: 'before' | 'after', isWorkspace: boolean): void;
}

interface ISessionDropTargetHeader {
	readonly kind: 'group' | 'section';
	readonly id: string;
}

interface ISessionMembershipDropTarget {
	readonly sessions: ISession[];
	readonly header: ISessionDropTargetHeader;
	readonly target: ISession | undefined;
	readonly position: 'before' | 'after' | undefined;
}

interface ISessionAddToGroupDropTarget extends ISessionMembershipDropTarget {
	readonly groupId: string;
}

/** A top-level header (group or workspace section) currently being dragged to reorder. */
interface IDraggedHeader {
	/** The reorder identity (`group:<id>` or `workspace:<label>`). */
	readonly id: string;
	/** Whether the dragged header is a workspace section (vs. a user group). */
	readonly isWorkspace: boolean;
}

class SessionsListDragAndDrop extends Disposable implements ITreeDragAndDrop<SessionListItem> {

	private readonly _transfer = LocalSelectionTransfer.getInstance<DraggedSessionIdentifier>();

	constructor(private readonly delegate: ISessionsListDndDelegate) {
		super();
	}

	getDragURI(element: SessionListItem): string | null {
		if (isSessionGroupItem(element)) {
			return `sessionGroup:${element.group.id}`;
		}
		if (isSessionSection(element)) {
			// Only workspace sections are reorderable; Pinned, Done and the date
			// sections stay fixed and are therefore not draggable.
			return element.id.startsWith('workspace:') ? `sessionWorkspace:${element.id}` : null;
		}
		if (isSessionShowMore(element)) {
			return null;
		}
		return element.resource.toString();
	}

	getDragLabel(elements: SessionListItem[]): string | undefined {
		const groupItem = elements.find(isSessionGroupItem);
		if (groupItem) {
			return groupItem.group.name;
		}
		const workspaceSection = elements.find((e): e is ISessionSection => isSessionSection(e) && e.id.startsWith('workspace:'));
		if (workspaceSection) {
			return workspaceSection.label;
		}
		const sessions = this.toSessions(elements);
		if (sessions.length === 0) {
			return undefined;
		}
		if (sessions.length === 1) {
			return sessions[0].title.get();
		}
		return localize('sessions.dragLabel', "{0} sessions", sessions.length);
	}

	onDragStart(data: IDragAndDropData, originalEvent: DragEvent): void {
		const sessions = this.toSessions(data instanceof ElementsDragAndDropData ? data.elements as SessionListItem[] : []);
		if (sessions.length === 0) {
			return;
		}

		const identifiers = sessions.map(s => new DraggedSessionIdentifier(s.sessionId, s.resource));
		this._transfer.setData(identifiers, DraggedSessionIdentifier.prototype);

		if (originalEvent.dataTransfer) {
			// Expose the first dragged session as a typed payload as well so external
			// drop handlers can read it without using the local transfer.
			const payload = JSON.stringify({ sessionId: sessions[0].sessionId, resource: sessions[0].resource.toString() });
			originalEvent.dataTransfer.setData(SessionsDataTransfers.SESSION, payload);
		}
	}

	onDragEnd(): void {
		this._transfer.clearData(DraggedSessionIdentifier.prototype);
		this.delegate.setDropTargetHeader(undefined);
	}

	onDragOver(data: IDragAndDropData, targetElement: SessionListItem | undefined, _targetIndex: number | undefined, targetSector: ListViewTargetSector | undefined): boolean | ITreeDragOverReaction {
		const draggedHeader = this.draggedHeader(data);
		if (draggedHeader) {
			this.delegate.setDropTargetHeader(undefined);
			return this.onHeaderDragOver(draggedHeader, targetElement, targetSector);
		}

		const pinTarget = this.resolvePinTarget(data, targetElement, targetSector);
		if (pinTarget) {
			this.delegate.setDropTargetHeader(pinTarget.header);
			return this.toMembershipDropReaction(pinTarget);
		}

		const addToGroupTarget = this.resolveAddToGroupTarget(data, targetElement, targetSector);
		if (addToGroupTarget) {
			this.delegate.setDropTargetHeader(addToGroupTarget.header);
			return this.toMembershipDropReaction(addToGroupTarget);
		}

		this.delegate.setDropTargetHeader(undefined);
		const target = this.resolveReorderTarget(data, targetElement);
		if (!target) {
			return false;
		}
		const position = sectorToPosition(targetSector);
		return {
			accept: true,
			effect: {
				type: ListDragOverEffectType.Move,
				position: position === 'after' ? ListDragOverEffectPosition.After : ListDragOverEffectPosition.Before,
			},
		};
	}

	drop(data: IDragAndDropData, targetElement: SessionListItem | undefined, _targetIndex: number | undefined, targetSector: ListViewTargetSector | undefined): void {
		this.delegate.setDropTargetHeader(undefined);
		try {
			const draggedHeader = this.draggedHeader(data);
			if (draggedHeader) {
				if (targetElement) {
					const targetRef = this.headerRefOf(targetElement);
					if (targetRef && targetRef !== draggedHeader.id) {
						this.delegate.reorderSection(draggedHeader.id, targetRef, sectorToPosition(targetSector), draggedHeader.isWorkspace);
					}
				}
				return;
			}

			const pinTarget = this.resolvePinTarget(data, targetElement, targetSector);
			if (pinTarget) {
				this.delegate.pinSessions(pinTarget.sessions, pinTarget.target, pinTarget.position);
				return;
			}

			const addToGroupTarget = this.resolveAddToGroupTarget(data, targetElement, targetSector);
			if (addToGroupTarget) {
				this.delegate.addSessionsToGroup(addToGroupTarget.sessions, addToGroupTarget.groupId, addToGroupTarget.target, addToGroupTarget.position);
				return;
			}

			const target = this.resolveReorderTarget(data, targetElement);
			if (!target) {
				return;
			}
			this.delegate.reorder(this.draggedSessions(data), target, sectorToPosition(targetSector));
		} finally {
			this.delegate.setDropTargetHeader(undefined);
		}
	}

	private onHeaderDragOver(draggedHeader: IDraggedHeader, targetElement: SessionListItem | undefined, targetSector: ListViewTargetSector | undefined): boolean | ITreeDragOverReaction {
		if (!targetElement) {
			return false;
		}
		const targetRef = this.headerRefOf(targetElement);
		if (!targetRef || targetRef === draggedHeader.id) {
			return false;
		}
		const position = sectorToPosition(targetSector);
		return {
			accept: true,
			effect: {
				type: ListDragOverEffectType.Move,
				position: position === 'after' ? ListDragOverEffectPosition.After : ListDragOverEffectPosition.Before,
			},
		};
	}

	private resolvePinTarget(data: IDragAndDropData, targetElement: SessionListItem | undefined, targetSector: ListViewTargetSector | undefined): ISessionMembershipDropTarget | undefined {
		if (!targetElement) {
			return undefined;
		}

		let target: ISession | undefined;
		if (isSessionSection(targetElement)) {
			if (targetElement.id !== 'pinned') {
				return undefined;
			}
		} else if (isSessionItem(targetElement) && this.delegate.isSessionPinned(targetElement)) {
			target = targetElement;
		} else {
			return undefined;
		}

		const dragged = this.draggedSessions(data);
		const hasArchived = dragged.some(session => session.isArchived.get());
		const allPinned = dragged.every(session => this.delegate.isSessionPinned(session));
		if (dragged.length === 0 || hasArchived || allPinned) {
			return undefined;
		}
		if (target && dragged.some(session => session.sessionId === target.sessionId)) {
			return undefined;
		}
		return {
			sessions: dragged,
			header: { kind: 'section', id: 'pinned' },
			target,
			position: target ? sectorToPosition(targetSector) : undefined,
		};
	}

	private resolveAddToGroupTarget(data: IDragAndDropData, targetElement: SessionListItem | undefined, targetSector: ListViewTargetSector | undefined): ISessionAddToGroupDropTarget | undefined {
		if (!targetElement) {
			return undefined;
		}
		let groupId: string | undefined;
		let target: ISession | undefined;
		if (isSessionGroupItem(targetElement)) {
			groupId = targetElement.group.id;
		} else if (isSessionItem(targetElement)) {
			groupId = this.delegate.getGroupIdOfSession(targetElement);
			target = groupId === undefined ? undefined : targetElement;
		}
		if (groupId === undefined) {
			return undefined;
		}

		const dragged = this.draggedSessions(data);
		const hasArchived = dragged.some(session => session.isArchived.get());
		const allInGroup = dragged.every(session => this.delegate.getGroupIdOfSession(session) === groupId);
		if (dragged.length === 0 || hasArchived || allInGroup) {
			return undefined;
		}
		if (target && dragged.some(session => session.sessionId === target.sessionId)) {
			return undefined;
		}
		return {
			sessions: dragged,
			groupId,
			header: { kind: 'group', id: groupId },
			target,
			position: target ? sectorToPosition(targetSector) : undefined,
		};
	}

	/**
	 * Resolve the session the drop should be positioned against, or `undefined`
	 * if the current drag is not a valid in-list reorder.
	 */
	private resolveReorderTarget(data: IDragAndDropData, targetElement: SessionListItem | undefined): ISession | undefined {
		if (!targetElement || !isSessionItem(targetElement)) {
			return undefined;
		}
		const target = targetElement;
		if (!this.delegate.isReorderable(target)) {
			return undefined;
		}
		const dragged = this.draggedSessions(data);
		if (dragged.length === 0 || dragged.some(s => s.sessionId === target.sessionId)) {
			return undefined;
		}
		if (dragged.some(s => !this.delegate.isReorderable(s))) {
			return undefined;
		}
		if (!this.delegate.canDropOn(dragged, target)) {
			return undefined;
		}
		return target;
	}

	private toMembershipDropReaction(target: ISessionMembershipDropTarget): ITreeDragOverReaction {
		let position = ListDragOverEffectPosition.Over;
		if (target.position === 'after') {
			position = ListDragOverEffectPosition.After;
		} else if (target.position === 'before') {
			position = ListDragOverEffectPosition.Before;
		}
		return {
			accept: true,
			effect: {
				type: ListDragOverEffectType.Move,
				position,
			},
		};
	}

	private draggedHeader(data: IDragAndDropData): IDraggedHeader | undefined {
		if (!(data instanceof ElementsDragAndDropData)) {
			return undefined;
		}
		const elements = data.elements as SessionListItem[];
		const groupItem = elements.find(isSessionGroupItem);
		if (groupItem) {
			return { id: `group:${groupItem.group.id}`, isWorkspace: false };
		}
		const workspaceSection = elements.find((e): e is ISessionSection => isSessionSection(e) && e.id.startsWith('workspace:'));
		if (workspaceSection) {
			return { id: workspaceSection.id, isWorkspace: true };
		}
		return undefined;
	}

	/** The reorder identity of a top-level header element, or `undefined` when it is not reorderable. */
	private headerRefOf(element: SessionListItem): string | undefined {
		if (isSessionGroupItem(element)) {
			return `group:${element.group.id}`;
		}
		if (isSessionSection(element) && element.id.startsWith('workspace:')) {
			return element.id;
		}
		return undefined;
	}

	private draggedSessions(data: IDragAndDropData): ISession[] {
		return this.toSessions(data instanceof ElementsDragAndDropData ? data.elements as SessionListItem[] : []);
	}

	private toSessions(elements: SessionListItem[]): ISession[] {
		return elements.filter(isSessionItem);
	}
}

function sectorToPosition(sector: ListViewTargetSector | undefined): 'before' | 'after' {
	return sector !== undefined && sector >= ListViewTargetSector.CENTER_BOTTOM ? 'after' : 'before';
}

//#endregion

//#region Sessions List Control

export interface ISessionsListControlOptions {
	readonly overrideStyles?: IStyleOverride<IListStyles>;
	readonly grouping: () => SessionsGrouping;
	readonly sorting: () => SessionsSorting;
	/** Whether the list renders its title-only compact density. */
	readonly compact?: () => boolean;
	readonly findWidgetContainer?: HTMLElement;
	onSessionOpen(resource: URI, preserveFocus: boolean, sideBySide: boolean): void | Promise<void>;
}

/**
 * @deprecated Use {@link ISessionsListControlOptions} instead.
 */
export type ISessionsListOptions = ISessionsListControlOptions;

/**
 * A session open the list has started and may still re-invoke, so that a
 * double-click landing on the row can turn it into a focus-preserving open.
 */
interface IListOpenRequest {
	readonly session: ISession;
	readonly sideBySide: boolean;
	preserveFocus: boolean;
	invocation: number;
}

/**
 * Whether opening `session` should also mark it read. Re-opening the session you
 * are already viewing must not clobber an explicit "Mark as Unread" on it: the
 * mark is only meaningful while the session stays active, so leave it alone
 * until the user leaves and comes back.
 */
export function shouldMarkReadOnOpen(session: ISession, activeSession: { readonly sessionId: string } | undefined): boolean {
	return activeSession?.sessionId !== session.sessionId;
}

export interface ISessionsList {
	readonly element: HTMLElement;
	readonly onDidUpdate: Event<void>;
	readonly onDidChangeFindOpenState: Event<boolean>;
	refresh(): void;
	reveal(sessionResource: URI): boolean;
	/**
	 * Returns the sessions currently visible in the list, in display order.
	 * Sessions hidden by section capping ("show more") are excluded.
	 */
	getVisibleSessions(): readonly ISession[];
	clearFocus(): void;
	hasFocusOrSelection(): boolean;
	/**
	 * The focused selection while this list owns DOM focus, or `undefined` when it
	 * does not, so a command can tell "not my target" from "no session focused".
	 */
	getFocusedSessions(): readonly ISession[] | undefined;
	setVisible(visible: boolean): void;
	layout(height: number, width: number): void;
	/** Re-read the compact option and re-render at the new density. */
	setCompact(): void;
	focus(): void;
	update(expandAll?: boolean): void;
	openFind(): void;
	closeFind(): void;
	resetSectionCollapseState(): void;
	pinSession(session: ISession): void;
	unpinSession(session: ISession): void;
	isSessionPinned(session: ISession): boolean;
	setSessionTypeExcluded(sessionTypeId: string, excluded: boolean): void;
	isSessionTypeExcluded(sessionTypeId: string): boolean;
	setStatusExcluded(status: SessionStatus, excluded: boolean): void;
	isStatusExcluded(status: SessionStatus): boolean;
	setExcludeArchived(exclude: boolean): void;
	isExcludeArchived(): boolean;
	setExcludeRead(exclude: boolean): void;
	isExcludeRead(): boolean;
	resetFilters(): void;
	setWorkspaceGroupCapped(capped: boolean): void;
	isWorkspaceGroupCapped(): boolean;
	setOpenWindowSourceFolder(folder: URI | undefined): void;
	collapseAllSections(): void;
	createGroupFromSessions(sessions: ISession[]): void;
	beginRenameGroup(groupId: string): void;
	/** Opens the inline rename editor on `session`'s row. Returns `false` when it cannot be opened. */
	beginRenameSession(session: ISession): boolean;
	addSessionsToGroup(sessions: ISession[], groupId: string, target?: ISession, position?: 'before' | 'after'): void;
	getGroupsInDisplayOrder(): ISessionGroup[];
}

export class SessionsList extends Disposable implements ISessionsList {

	private static readonly SECTION_COLLAPSE_STATE_KEY = 'sessionsListControl.sectionCollapseState';
	private static readonly EXCLUDED_TYPES_KEY = 'sessionsListControl.excludedSessionTypes';
	private static readonly EXCLUDED_STATUSES_KEY = 'sessionsListControl.excludedStatuses';
	private static readonly EXCLUDE_ARCHIVED_KEY = 'sessionsListControl.excludeArchived';
	private static readonly EXCLUDE_READ_KEY = 'sessionsListControl.excludeRead';
	private static readonly WORKSPACE_GROUP_CAPPED_KEY = 'sessionsListControl.workspaceGroupCapped';
	private static readonly DEFAULT_SESSION_GROUP_LIMIT = 5;

	/**
	 * Experiment treatment that overrides how many sessions are shown per group
	 * before the "show more" affordance appears.
	 */
	private static readonly SESSION_GROUP_LIMIT_TREATMENT = 'sessions.workspaceGroupLimit';

	private readonly listContainer: HTMLElement;
	private readonly tree: WorkbenchObjectTree<SessionListItem, FuzzyScore>;
	private sessions: ISession[] = [];
	private visible = true;
	private readonly excludedSessionTypes: Set<string>;
	private readonly excludedStatuses: Set<SessionStatus>;
	private _excludeArchived: boolean;
	private _excludeRead: boolean;
	private workspaceGroupCapped: boolean;

	/**
	 * Maximum number of sessions shown per workspace section or user group.
	 */
	private readonly sessionGroupLimit = observableValue<number>(this, SessionsList.DEFAULT_SESSION_GROUP_LIMIT);
	private readonly expandedSessionGroups = new Set<string>();
	private expandedMoreFolders = false;
	private openWindowSourceFolder: URI | undefined;
	private hasFindPattern = false;
	private suspendCollapseStatePersistence = false;

	/** The group whose header is currently showing its inline name editor. */
	private _editingGroupId: string | undefined;
	private _groupRenderer!: SessionGroupRenderer;
	private _sectionRenderer!: SessionSectionRenderer;
	private _sessionRenderer!: SessionItemRenderer;
	private pendingOpenRequest: IListOpenRequest | undefined;
	private _dropTargetHeader: ISessionDropTargetHeader | undefined;

	/**
	 * Snapshot of the currently-rendered reorderable top-level headers (groups
	 * and, in workspace mode, workspace sections) in display order, by reorder
	 * identity. Captured each render and used as the basis for drag-reorder math.
	 */
	private _topLevelOrder: string[] = [];

	private readonly _onDidUpdate = this._register(new Emitter<void>());
	readonly onDidUpdate: Event<void> = this._onDidUpdate.event;

	private readonly _onDidChangeFindOpenState = this._register(new Emitter<boolean>());
	readonly onDidChangeFindOpenState: Event<boolean> = this._onDidChangeFindOpenState.event;

	get element(): HTMLElement { return this.listContainer; }

	/**
	 * Compact density is a desktop affordance: a phone row is already taller than a
	 * compact one and needs its touch targets, so the phone layout always wins.
	 */
	private isCompact(): boolean {
		return (this.options.compact?.() ?? false) && !IsPhoneLayoutContext.getValue(this.contextKeyService);
	}

	constructor(
		container: HTMLElement,
		private readonly options: ISessionsListControlOptions,
		@ISessionsManagementService private readonly _sessionsManagementService: ISessionsManagementService,
		@ISessionsService private readonly _sessionsService: ISessionsService,
		@ISessionsListModelService private readonly _sessionsListModelService: ISessionsListModelService,
		@ISessionGroupsService private readonly _sessionGroupsService: ISessionGroupsService,
		@ISessionSectionOrderService private readonly _sessionSectionOrderService: ISessionSectionOrderService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IMenuService private readonly menuService: IMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkbenchAssignmentService private readonly assignmentService: IWorkbenchAssignmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		// Load excluded session types from storage
		this.excludedSessionTypes = this.loadExcludedSessionTypes();

		// Load excluded statuses from storage
		this.excludedStatuses = this.loadExcludedStatuses();

		// Load archived/read filter state
		this._excludeArchived = this.storageService.getBoolean(SessionsList.EXCLUDE_ARCHIVED_KEY, StorageScope.PROFILE, true);
		this._excludeRead = this.storageService.getBoolean(SessionsList.EXCLUDE_READ_KEY, StorageScope.PROFILE, false);
		this.workspaceGroupCapped = this.storageService.getBoolean(SessionsList.WORKSPACE_GROUP_CAPPED_KEY, StorageScope.PROFILE, true);

		this.listContainer = DOM.append(container, $('.sessions-list-control.session-list-row-spacing'));
		this.listContainer.classList.toggle('compact', this.isCompact());
		this._register(DOM.addDisposableListener(this.listContainer, DOM.EventType.POINTER_DOWN, () => {
			this.listContainer.classList.add(SESSION_SECTION_FOCUS_FROM_POINTER_CLASS);
		}));
		this._register(DOM.addDisposableListener(this.listContainer.ownerDocument, DOM.EventType.KEY_DOWN, () => {
			this.listContainer.classList.remove(SESSION_SECTION_FOCUS_FROM_POINTER_CLASS);
		}, true));

		const approvalModel = this._register(instantiationService.createInstance(AgentSessionApprovalModel));
		const markdownRendererService = instantiationService.invokeFunction(accessor => accessor.get(IMarkdownRendererService));
		const hoverService = instantiationService.invokeFunction(accessor => accessor.get(IHoverService));
		const sessionsProvidersService = instantiationService.invokeFunction(accessor => accessor.get(ISessionsProvidersService));
		// TEMPORARY (#320480): see the note on the `IAgentSessionsService` import.
		const agentSessionsService = instantiationService.invokeFunction(accessor => accessor.get(IAgentSessionsService));
		const sessionRenderer = new SessionItemRenderer(
			{
				grouping: this.options.grouping,
				sorting: this.options.sorting,
				isPinned: s => this.isSessionPinned(s),
				isRead: s => this.isSessionRead(s),
				compact: () => this.isCompact(),
				visibleSessions: this._sessionsService.visibleSessions,
				getMultiSelectedSessions: s => this.getMultiSelectedSessions(s),
				inlineRename: true,
				contextViewService: this.contextViewService,
				onDidDoubleClickRename: session => this.preservePendingOpenFocus(session),
				onDidFinishRename: () => this.tree.domFocus(),
			},
			approvalModel,
			instantiationService,
			contextKeyService,
			markdownRendererService,
			hoverService,
			sessionsProvidersService,
			agentSessionsService,
			this._sessionsManagementService,
		);
		this._sessionRenderer = sessionRenderer;

		const showMoreRenderer = new SessionShowMoreRenderer();
		const showUnreadInCollapsedSections = observableConfigValue(SESSIONS_LIST_SHOW_UNREAD_IN_COLLAPSED_SECTIONS_SETTING, true, this.configurationService);
		const sectionRenderer = new SessionSectionRenderer(true /* hideSectionCount */, showUnreadInCollapsedSections, instantiationService, contextKeyService);
		this._sectionRenderer = sectionRenderer;
		const groupRenderer = new SessionGroupRenderer({
			commitEdit: (group, name) => this.commitGroupEdit(group, name),
			cancelEdit: group => this.cancelGroupEdit(group),
		}, showUnreadInCollapsedSections, instantiationService, contextKeyService);
		this._groupRenderer = groupRenderer;

		// Read (don't bind) `IsPhoneLayoutContext` from the parent context so we
		// observe the workbench's value rather than shadowing it with a fresh
		// scoped default of `false`. The reactive height refresh below listens
		// on the same scoped service for changes.
		const delegate = new SessionsTreeDelegate(
			approvalModel,
			() => !!IsPhoneLayoutContext.getValue(contextKeyService),
			() => this.isCompact(),
			true /* useInsetRowSpacing */,
		);

		this.tree = this._register(instantiationService.createInstance(
			WorkbenchObjectTree<SessionListItem, FuzzyScore>,
			'SessionsListTree',
			this.listContainer,
			delegate,
			[
				sessionRenderer,
				sectionRenderer,
				groupRenderer,
				showMoreRenderer,
			],
			{
				accessibilityProvider: new SessionsAccessibilityProvider({ showUnreadInCollapsedSections }),
				dnd: this._register(new SessionsListDragAndDrop({
					isReorderable: session => this.isReorderable(session),
					isSessionPinned: session => this.isSessionPinned(session),
					canDropOn: (dragged, target) => this.canReorderOnto(dragged, target),
					reorder: (dragged, target, position) => this.reorderSessions(dragged, target, position),
					getGroupIdOfSession: session => this._sessionGroupsService.getGroupOfSession(session.sessionId),
					addSessionsToGroup: (sessions, groupId, target, position) => this.addSessionsToGroup(sessions, groupId, target, position),
					pinSessions: (sessions, target, position) => this.pinSessions(sessions, target, position),
					setDropTargetHeader: header => this.setDropTargetHeader(header),
					reorderSection: (draggedId, targetId, position, isWorkspace) => this.reorderSection(draggedId, targetId, position, isWorkspace),
				})),
				identityProvider: {
					getId: (element: SessionListItem) => {
						if (isSessionGroupItem(element)) {
							return `group:${element.group.id}`;
						}
						if (isSessionSection(element)) {
							return `section:${element.id}`;
						}
						if (isSessionShowMore(element)) {
							return `show-more:${element.kind}:${element.mode}:${element.sectionId}`;
						}
						return element.resource.toString();
					},
					getGroupId: (element: SessionListItem) => {
						if (isSessionGroupItem(element)) {
							return NotSelectableGroupId;
						}
						if (isSessionSection(element)) {
							return NotSelectableGroupId;
						}
						if (isSessionShowMore(element)) {
							return NotSelectableGroupId;
						}
						// Use a distinct group for archived (done) sessions so that
						// multi-selection cannot span the workspace and done sections.
						return element.isArchived.get() ? 2 : 1;
					}
				},
				horizontalScrolling: false,
				multipleSelectionSupport: true,
				indent: 0,
				findWidgetEnabled: true,
				defaultFindMode: TreeFindMode.Filter,
				findWidgetContainer: this.options.findWidgetContainer,
				findWidgetStyles: {
					...defaultFindWidgetStyles,
					toggleStyles: {
						...defaultToggleStyles,
						inputActiveOptionBorder: 'transparent',
					},
				},
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (element: SessionListItem) => {
						if (isSessionGroupItem(element)) {
							return element.group.name;
						}
						if (isSessionSection(element)) {
							return element.label;
						}
						if (isSessionShowMore(element)) {
							return element.sectionLabel;
						}
						return element.title.get();
					}
				},
				overrideStyles: this.options.overrideStyles,
				renderIndentGuides: RenderIndentGuides.None,
				twistieAdditionalCssClass: () => 'force-no-twistie',
			}
		));

		this._register(this.tree.onDidOpen(e => {
			const element = e.element;
			if (!element) {
				return;
			}
			if (isSessionShowMore(element)) {
				if (element.kind === 'folders') {
					this.expandedMoreFolders = element.mode === 'more';
				} else {
					if (element.mode === 'more') {
						this.expandedSessionGroups.add(element.sectionId);
					} else {
						this.expandedSessionGroups.delete(element.sectionId);
					}
				}
				this.update();
				return;
			}
			if (!isSessionSection(element) && !isSessionGroupItem(element)) {
				// A deliberate left mouse click on a session should move keyboard
				// focus into the chat input so the user can start typing right
				// away. A single click always reports `preserveFocus: true`, so
				// detect the mouse click explicitly. Keyboard navigation keeps
				// `preserveFocus` as reported so browsing the list never steals
				// focus from it.
				const isLeftClick = DOM.isMouseEvent(e.browserEvent) && e.browserEvent.button === 0;
				const preserveFocus = isLeftClick ? false : (e.editorOptions.preserveFocus ?? false);
				this.beginOpenRequest(element, preserveFocus, e.sideBySide);
			}
		}));

		this._register(sessionRenderer.onDidChangeItemHeight(session => {
			if (this.tree.hasElement(session)) {
				this.tree.updateElementHeight(session, delegate.getHeight(session));
			}
		}));

		// React to phone <-> desktop viewport transitions: refresh heights
		// for all known sessions so the virtual list reserves the correct
		// space for the new layout. Iterates `this.sessions` (all known
		// sessions) — a phone/desktop transition is a rare event so the
		// extra work over filtered-out sessions is negligible. Relies on
		// the `IsPhoneLayoutContext` reactive signal already maintained by
		// the agents workbench.
		const phoneKeys = new Set<string>([IsPhoneLayoutContext.key]);
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (!e.affectsSome(phoneKeys)) {
				return;
			}
			// Phone layout also decides the effective compact density, so the
			// transition has to re-render, not just re-measure.
			this.setCompact();
		}));

		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		this._register(this.tree.onDidChangeCollapseState(e => {
			const element = e.node.element;
			if (element && isSessionGroupItem(element)) {
				this._groupRenderer.updateCollapseState(element, e.node.collapsed);
				if (!this.suspendCollapseStatePersistence) {
					this.saveSectionCollapseState(`group:${element.group.id}`, e.node.collapsed);
				}
			} else if (element && isSessionSection(element)) {
				sectionRenderer.updateCollapseState(element, e.node.collapsed);
				if (!this.suspendCollapseStatePersistence) {
					this.saveSectionCollapseState(element.id, e.node.collapsed);
				}
			}
		}));

		let isFindOpen = false;
		let findPattern = '';
		const updateFindPatternState = () => {
			const hasFindPattern = isFindOpen && findPattern.length > 0;
			if (hasFindPattern !== this.hasFindPattern) {
				this.hasFindPattern = hasFindPattern;
				this.update();
			}
		};

		this._register(this.tree.onDidChangeFindOpenState(open => {
			isFindOpen = open;
			this._onDidChangeFindOpenState.fire(open);
			updateFindPatternState();
		}));

		// Only treat the find as "active" for layout purposes (bypassing workspace
		// capping and per-group limits) once the user has actually typed a pattern
		// and the find widget is open. Opening the empty find widget should not
		// reorder the list, and closing find should restore the capped layout.
		this._register(this.tree.onDidChangeFindPattern(pattern => {
			findPattern = pattern;
			updateFindPatternState();
		}));

		this._register(this._sessionsManagementService.onDidChangeSessions(() => {
			if (this.visible) {
				this.refresh();
			}
		}));

		this._register(this._sessionsListModelService.onDidChange(() => {
			if (this.visible) {
				this.update();
			}
		}));

		this._register(this._sessionGroupsService.onDidChange(() => {
			if (this.visible) {
				this.update();
			}
		}));

		this._register(this._sessionSectionOrderService.onDidChange(() => {
			if (this.visible) {
				this.update();
			}
		}));

		// Re-update when the active session changes so that a filtered-out
		// session becomes visible while active and hides again when unselected.
		// Also mark the newly active session as read.
		this._register(autorun(reader => {
			const activeSession = this._sessionsService.activeSession.read(reader);
			if (activeSession) {
				this._sessionsListModelService.markRead(activeSession);
			}
			if (this.visible) {
				this.update();
			}
		}));

		// Resolve the per-group session limit from the experiment service and
		// keep it current when treatments are refetched. The async fetch is
		// confined to `updateSessionGroupLimit`; the rest of the list reads the
		// resolved value synchronously off `sessionGroupLimit`. The autorun runs
		// immediately for the initial fetch and again whenever treatments refetch.
		const assignmentRefetchSignal = observableSignalFromEvent(this, this.assignmentService.onDidRefetchAssignments);
		this._register(autorun(reader => {
			assignmentRefetchSignal.read(reader);
			this.updateSessionGroupLimit();
		}));

		this.refresh();
	}

	/**
	 * Fetches the session group limit treatment and updates the backing
	 * observable. Invalid or unset treatments fall back to the default limit.
	 */
	private updateSessionGroupLimit(): void {
		this.assignmentService.getTreatment<number>(SessionsList.SESSION_GROUP_LIMIT_TREATMENT).then(value => {
			const limit = typeof value === 'number' && Number.isInteger(value) && value > 0
				? value
				: SessionsList.DEFAULT_SESSION_GROUP_LIMIT;
			if (this.sessionGroupLimit.get() !== limit) {
				this.sessionGroupLimit.set(limit, undefined);
				if (this.visible) {
					this.update();
				}
			}
		});
	}

	refresh(): void {
		this.sessions = this._sessionsManagementService.getSessions();
		this.update();
	}

	update(expandAll?: boolean): void {
		const activeSession = this._sessionsService.activeSession.get();

		// Filter by session type and status
		let filtered = this.sessions;
		if (this.excludedSessionTypes.size > 0) {
			filtered = filtered.filter(s => !this.excludedSessionTypes.has(s.sessionType));
		}
		if (this.excludedStatuses.size > 0) {
			filtered = filtered.filter(s => !this.excludedStatuses.has(s.status.get()));
		}
		if (this._excludeArchived) {
			filtered = filtered.filter(s => !s.isArchived.get());
		}
		if (this._excludeRead) {
			filtered = filtered.filter(s => !this.isSessionRead(s));
		}

		// Always include the active session even if it was filtered out,
		// so it remains visible while selected
		if (activeSession && !filtered.some(s => s.sessionId === activeSession.sessionId)) {
			const match = this.sessions.find(s => s.sessionId === activeSession.sessionId);
			if (match) {
				filtered = [...filtered, match];
			}
		}

		const grouping = this.options.grouping();
		const sorting = this.options.sorting();
		const sortKeyForGrouping = (s: ISession, srt: SessionsSorting) => this._sessionsListModelService.getSortKey(s, sortingToMode(srt));

		// Garbage-collect manual order/promotion entries for groups and
		// workspaces that no longer exist (does not affect the visible order).
		this._sessionSectionOrderService.retain(this.liveSectionOrderIds());

		// Pull regular (non-pinned, non-archived) grouped sessions out of the
		// normal date/workspace sectioning so they render under their group.
		// Pinned and archived sessions keep their precedence and stay in their
		// sections even when they belong to a group (their membership is
		// retained so they return to the group once unpinned/restored).
		const groupedMembers = new Map<string, ISession[]>();
		const groupedRegularIds = new Set<string>();
		for (const s of filtered) {
			if (s.isArchived.get() || this.isSessionPinned(s)) {
				continue;
			}
			const groupId = this._sessionGroupsService.getGroupOfSession(s.sessionId);
			if (groupId !== undefined && this._sessionGroupsService.getGroup(groupId)) {
				let members = groupedMembers.get(groupId);
				if (!members) {
					members = [];
					groupedMembers.set(groupId, members);
				}
				members.push(s);
				groupedRegularIds.add(s.sessionId);
			}
		}
		// Keep a group being renamed visible even if it currently has no visible
		// members, so its inline name editor stays on screen.
		if (this._editingGroupId && this._sessionGroupsService.getGroup(this._editingGroupId) && !groupedMembers.has(this._editingGroupId)) {
			groupedMembers.set(this._editingGroupId, []);
		}

		const forSections = groupedRegularIds.size > 0 ? filtered.filter(s => !groupedRegularIds.has(s.sessionId)) : filtered;

		// Build the group blocks with members sorted by the normal sort logic.
		// Groups are fully user-managed: their order is owned by the section-order
		// service (defaulting to newest-first), independent of their members'
		// recency, and is shared across both grouping modes.
		const groupItemsById = new Map<string, ISessionGroupItem>();
		for (const [groupId, members] of groupedMembers) {
			const group = this._sessionGroupsService.getGroup(groupId)!;
			const sortedMembers = sortSessions(members, sorting, sortKeyForGrouping);
			groupItemsById.set(groupId, { group, sessions: sortedMembers, editing: group.id === this._editingGroupId });
		}
		const defaultGroupIds = [...groupItemsById.values()]
			.sort((a, b) => b.group.createdAt - a.group.createdAt)
			.map(item => `group:${item.group.id}`);

		const sections = groupSessionsForList(forSections, grouping, sorting, session => this.isSessionPinned(session), (s, srt) => this._sessionsListModelService.getSortKey(s, sortingToMode(srt)));

		const hasTodaySessions = sections.some(s => s.id === 'today' && s.sessions.length > 0);

		// Partition workspace sections into "primary" (meets criteria) and "more"
		// when grouping by workspace. An active find pattern bypasses partitioning
		// so all matching sessions are visible. When the user has chosen
		// "Show All Sessions" (uncapped), show every workspace group inline instead
		// of hiding some behind a "more workspaces" entry.
		const partitionFolders = grouping === SessionsGrouping.Workspace && !this.hasFindPattern && this.workspaceGroupCapped;
		const moreFolderSectionIds = new Set<string>();
		if (partitionFolders) {
			const workspaceSections = sections.filter(s => s.id.startsWith('workspace:'));
			if (workspaceSections.length > 0) {
				const now = Date.now();
				const isRecent = (section: ISessionSection) =>
					section.sessions.some(s => s.updatedAt.get().getTime() >= now - FOUR_DAYS_MS);
				const isOpenWindow = (section: ISessionSection) =>
					!!this.openWindowSourceFolder && section.sessions.some(s => sessionMatchesFolder(s, this.openWindowSourceFolder!));
				const meetsCriteria = (section: ISessionSection) => isRecent(section) || isOpenWindow(section);

				let anyMeets = false;
				for (const section of workspaceSections) {
					if (meetsCriteria(section)) {
						anyMeets = true;
						break;
					}
				}

				let fallbackId: string | undefined;
				if (!anyMeets) {
					// Criterion 3: pick the folder with the most recently updated session.
					let bestTime = -Infinity;
					for (const section of workspaceSections) {
						for (const s of section.sessions) {
							const t = s.updatedAt.get().getTime();
							if (t > bestTime) {
								bestTime = t;
								fallbackId = section.id;
							}
						}
					}
				}

				for (const section of workspaceSections) {
					if (!meetsCriteria(section) && section.id !== fallbackId && !this._sessionSectionOrderService.isPromoted(section.id)) {
						moreFolderSectionIds.add(section.id);
					}
				}
			}
		}

		const children: IObjectTreeElement<SessionListItem>[] = [];

		const sessionGroupLimit = this.sessionGroupLimit.get();

		const toSessionChildren = (sessions: readonly ISession[]): IObjectTreeElement<SessionListItem>[] =>
			sessions.map(session => ({ element: session as SessionListItem }));

		const renderSessionChildren = (sessions: readonly ISession[], sectionId: string, sectionLabel: string, enabled: boolean): IObjectTreeElement<SessionListItem>[] => {
			const limited = limitSessionsForList(sessions, sessionGroupLimit, {
				enabled,
				expanded: this.expandedSessionGroups.has(sectionId),
				sectionId,
				sectionLabel,
			});
			const children = toSessionChildren(limited.sessions);
			if (limited.showMore) {
				children.push({ element: limited.showMore });
			}
			return children;
		};

		const renderSection = (section: ISessionSection): IObjectTreeElement<SessionListItem> => {
			const isWorkspaceGroup = grouping === SessionsGrouping.Workspace
				&& section.id.startsWith('workspace:');
			const limitSessions = isWorkspaceGroup
				&& !this.hasFindPattern
				&& this.workspaceGroupCapped;
			const sectionChildren = renderSessionChildren(section.sessions, section.id, section.label, limitSessions);

			// Default collapse state for older time sections
			let defaultCollapsed: boolean | ObjectTreeElementCollapseState = ObjectTreeElementCollapseState.PreserveOrExpanded;
			if (grouping === SessionsGrouping.Date && hasTodaySessions) {
				const olderSections = ['yesterday', 'thisWeek', 'older', 'archived'];
				if (olderSections.includes(section.id)) {
					defaultCollapsed = ObjectTreeElementCollapseState.PreserveOrCollapsed;
				}
			}
			if (section.id === 'archived') {
				defaultCollapsed = ObjectTreeElementCollapseState.PreserveOrCollapsed;
			}

			return {
				element: section as SessionListItem,
				collapsible: true,
				collapsed: this.getSavedCollapseState(section.id) ?? defaultCollapsed,
				children: sectionChildren,
			};
		};

		const renderGroup = (groupItem: ISessionGroupItem): IObjectTreeElement<SessionListItem> => {
			return {
				element: groupItem,
				collapsible: true,
				collapsed: this.getSavedCollapseState(`group:${groupItem.group.id}`) ?? ObjectTreeElementCollapseState.PreserveOrExpanded,
				children: renderSessionChildren(groupItem.sessions, `group:${groupItem.group.id}`, groupItem.group.name, !this.hasFindPattern && this.workspaceGroupCapped),
			};
		};

		const pinnedSection = sections.find(s => s.id === 'pinned');
		if (pinnedSection) {
			children.push(renderSection(pinnedSection));
		}

		const renderGroupById = (id: string): void => {
			const groupItem = groupItemsById.get(id.slice('group:'.length));
			if (groupItem) {
				children.push(renderGroup(groupItem));
			}
		};

		if (grouping === SessionsGrouping.Date) {
			// Groups form a contiguous, fully user-ordered block right below the
			// Pinned section. They no longer interleave with the date sections by
			// recency and never mix into Today/Yesterday/etc. Pinned stays at the
			// top, Done (archived) stays at the bottom.
			const resolvedGroupIds = this._sessionSectionOrderService.resolveOrder(defaultGroupIds);
			this._topLevelOrder = resolvedGroupIds;
			for (const id of resolvedGroupIds) {
				renderGroupById(id);
			}
			for (const section of sections) {
				if (section.id === 'pinned' || section.id === 'archived') {
					continue;
				}
				children.push(renderSection(section));
			}
			const archived = sections.find(s => s.id === 'archived');
			if (archived) {
				children.push(renderSection(archived));
			}
		} else {
			// Workspace grouping: groups and (primary) workspace sections share one
			// freely-reorderable, user-managed order right below Pinned. Groups
			// default above workspaces; workspaces default to their alphabetical
			// order. Pinned stays first, Done last, and hidden ("+N more")
			// workspaces are appended below the ordered block.
			const workspaceSections = sections.filter(s => s.id.startsWith('workspace:'));
			const sectionById = new Map(workspaceSections.map(s => [s.id, s] as const));
			const primaryWorkspaceIds = workspaceSections
				.filter(s => !moreFolderSectionIds.has(s.id))
				.map(s => s.id);

			const defaultOrder = [...defaultGroupIds, ...primaryWorkspaceIds];
			const resolvedIds = this._sessionSectionOrderService.resolveOrder(defaultOrder);
			this._topLevelOrder = resolvedIds;
			for (const id of resolvedIds) {
				if (id.startsWith('group:')) {
					renderGroupById(id);
				} else {
					const section = sectionById.get(id);
					if (section) {
						children.push(renderSection(section));
					}
				}
			}

			const moreFolderSections = workspaceSections.filter(s => moreFolderSectionIds.has(s.id));
			if (moreFolderSections.length > 0) {
				if (this.expandedMoreFolders) {
					for (const section of moreFolderSections) {
						children.push(renderSection(section));
					}
					children.push({
						element: { showMore: true as const, kind: 'folders' as const, mode: 'less' as const, sectionId: SHOW_MORE_FOLDERS_LABEL, sectionLabel: SHOW_MORE_FOLDERS_LABEL, remainingCount: 0 },
					});
				} else {
					children.push({
						element: { showMore: true as const, kind: 'folders' as const, mode: 'more' as const, sectionId: SHOW_MORE_FOLDERS_LABEL, sectionLabel: SHOW_MORE_FOLDERS_LABEL, remainingCount: moreFolderSections.length },
					});
				}
			}

			// The archived ("Done") section is always the very last entry.
			const archivedSection = sections.find(s => s.id === 'archived');
			if (archivedSection) {
				children.push(renderSection(archivedSection));
			}
		}

		this.tree.setChildren(null, children);
		this._onDidUpdate.fire();
	}

	getVisibleSessions(): readonly ISession[] {
		// Derive the visible session list from the tree model so that index-based
		// navigation matches what the user actually sees: this respects collapsed
		// sections, find-widget filtering, and excludes section / show-more nodes.
		const sessions = new Set<ISession>(this.sessions);
		const visibleSessions: ISession[] = [];

		const collect = (node: ITreeNode<SessionListItem | null, FuzzyScore | undefined>): void => {
			if (!node.visible) {
				return;
			}
			if (node.element && sessions.has(node.element as ISession)) {
				visibleSessions.push(node.element as ISession);
			}
			if (node.collapsed) {
				return;
			}
			for (const child of node.children) {
				collect(child);
			}
		};

		const root = this.tree.getNode();
		for (const child of root.children) {
			collect(child);
		}

		return visibleSessions;
	}

	reveal(sessionResource: URI): boolean {
		const resourceStr = sessionResource.toString();
		for (const session of this.sessions) {
			if (session.resource.toString() === resourceStr) {
				if (this.tree.hasElement(session)) {
					if (this.tree.getRelativeTop(session) === null) {
						this.tree.reveal(session, 0.5);
					}
					this.tree.setFocus([session]);
					this.tree.setSelection([session]);
					return true;
				}
			}
		}
		return false;
	}

	clearFocus(): void {
		this.tree.setFocus([]);
		this.tree.setSelection([]);
	}

	hasFocusOrSelection(): boolean {
		return this.tree.getFocus().length > 0 || this.tree.getSelection().length > 0;
	}

	/**
	 * Returns the focused selection while this list owns DOM focus, or `undefined`
	 * otherwise. `undefined` and `[]` mean different things to a command: the
	 * former says "the list is not what is being acted on", so it may fall through
	 * to another target; the latter says the list is focused but on no session.
	 */
	getFocusedSessions(): readonly ISession[] | undefined {
		if (!DOM.isAncestorOfActiveElement(this.listContainer)) {
			return undefined;
		}

		const focusedSession = this.tree.getFocus().find((item): item is ISession => !!item && isSessionItem(item));
		return focusedSession ? this.getMultiSelectedSessions(focusedSession) : [];
	}

	setVisible(visible: boolean): void {
		if (this.visible === visible) {
			return;
		}
		this.visible = visible;
		if (this.visible) {
			this.refresh();
		}
	}

	layout(height: number, width: number): void {
		this.tree.layout(height, width);
	}

	setCompact(): void {
		this.listContainer.classList.toggle('compact', this.isCompact());
		this.update();
	}

	focus(): void {
		this.tree.domFocus();

		if (this.tree.getFocus().length === 0) {
			this.tree.focusFirst();
		}
	}

	openFind(): void {
		this.tree.openFind();
	}

	closeFind(): void {
		this.tree.closeFind();
	}

	// Context menu

	/**
	 * Whether a session may participate in manual reordering. Archived (Done)
	 * sessions keep their fixed section.
	 */
	private isReorderable(session: ISession): boolean {
		return !session.isArchived.get();
	}

	/**
	 * Whether the dragged sessions can be reordered relative to the target.
	 * Reordering stays within the same scope: dragged sessions must share the
	 * target's group membership, and (when grouping by workspace) its workspace.
	 */
	private canReorderOnto(dragged: ISession[], target: ISession): boolean {
		const targetPinned = this.isSessionPinned(target);
		if (dragged.some(s => this.isSessionPinned(s) !== targetPinned)) {
			return false;
		}
		if (targetPinned) {
			return true;
		}

		const targetGroup = this._sessionGroupsService.getGroupOfSession(target.sessionId);
		if (dragged.some(s => this._sessionGroupsService.getGroupOfSession(s.sessionId) !== targetGroup)) {
			return false;
		}
		if (targetGroup === undefined && this.options.grouping() === SessionsGrouping.Workspace) {
			const targetLabel = sessionWorkspaceLabel(target);
			return dragged.every(s => sessionWorkspaceLabel(s) === targetLabel);
		}
		return true;
	}

	/**
	 * Reorder the dragged sessions so they land as a contiguous block before or
	 * after the target session, persisting a synthetic sort key (the midpoint of
	 * the surrounding sessions' keys). When the dragged sessions' natural
	 * timestamps already sort them into the dropped slot, any stored override is
	 * dropped instead so the list falls back to natural ordering.
	 */
	private reorderSessions(dragged: ISession[], target: ISession, position: 'before' | 'after'): void {
		const mode = sortingToMode(this.options.sorting());
		const grouping = this.options.grouping();
		const getKey = (s: ISession) => this._sessionsListModelService.getSortKey(s, mode);

		// Derive neighbours from the actual visible display order (which already
		// respects filtering and grouping) so the drop slot matches what the user
		// sees.
		const targetPinned = this.isSessionPinned(target);
		let scope = this.getVisibleSessions().filter(s => this.isReorderable(s));
		scope = scope.filter(s => this.isSessionPinned(s) === targetPinned);
		if (!targetPinned) {
			const targetGroup = this._sessionGroupsService.getGroupOfSession(target.sessionId);
			scope = scope.filter(s => this._sessionGroupsService.getGroupOfSession(s.sessionId) === targetGroup);
			if (targetGroup === undefined && grouping === SessionsGrouping.Workspace) {
				const targetLabel = sessionWorkspaceLabel(target);
				scope = scope.filter(s => sessionWorkspaceLabel(s) === targetLabel);
			}
		}

		const draggedIds = new Set(dragged.map(s => s.sessionId));
		const draggedOrdered = scope.filter(s => draggedIds.has(s.sessionId));
		if (draggedOrdered.length === 0) {
			return;
		}
		const remaining = scope.filter(s => !draggedIds.has(s.sessionId));

		const targetIndex = remaining.findIndex(s => s.sessionId === target.sessionId);
		if (targetIndex === -1) {
			return;
		}

		const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
		const above = remaining[insertIndex - 1];
		const below = remaining[insertIndex];

		const { set, clear } = computeReorderSortChanges({
			draggedIds: draggedOrdered.map(s => s.sessionId),
			naturalKeys: draggedOrdered.map(s => this._sessionsListModelService.getNaturalSortKey(s, mode)),
			aboveKey: above ? getKey(above) : undefined,
			belowKey: below ? getKey(below) : undefined,
			now: Date.now(),
			fallbackStep: SORT_FALLBACK_STEP_MS,
		});
		this._sessionsListModelService.applySortChanges(mode, set, clear);
	}

	// -- Groups --

	/**
	 * Create a new group containing the given sessions and start renaming it.
	 * Archived (Done) sessions are ignored.
	 */
	createGroupFromSessions(sessions: ISession[]): void {
		const groupSessions = sessions.filter(session => !session.isArchived.get());
		if (groupSessions.length === 0) {
			return;
		}
		const group = this._sessionGroupsService.createGroup(localize('newGroupName', "New Group"), groupSessions.map(s => s.sessionId));
		this._editingGroupId = group.id;
		this.update();
	}

	/** Begin inline renaming of the group's header. */
	beginRenameGroup(groupId: string): void {
		if (!this._sessionGroupsService.getGroup(groupId)) {
			return;
		}
		this._editingGroupId = groupId;
		this.update();
	}

	/**
	 * Starts opening `session`, remembering the attempt so a double-click that
	 * lands right after can convert it into a focus-preserving open. The first
	 * click of a double-click already fires `onDidOpen` with `preserveFocus:
	 * false`, which would pull focus into the chat input and destroy the rename
	 * editor the second click is about to create.
	 */
	private beginOpenRequest(session: ISession, preserveFocus: boolean, sideBySide: boolean): void {
		const request: IListOpenRequest = { session, preserveFocus, sideBySide, invocation: 0 };
		this.pendingOpenRequest = request;
		if (shouldMarkReadOnOpen(session, this._sessionsService.activeSession.get())) {
			this.markRead(session);
		}
		this.invokeOpenRequest(request);
	}

	private invokeOpenRequest(request: IListOpenRequest): void {
		const invocation = ++request.invocation;
		const finish = () => {
			// Only the newest invocation of the newest request may clear the slot,
			// so a re-invocation does not drop a still-pending later one.
			if (this.pendingOpenRequest === request && request.invocation === invocation) {
				this.pendingOpenRequest = undefined;
			}
		};

		let open: void | Promise<void>;
		try {
			open = this.options.onSessionOpen(request.session.resource, request.preserveFocus, request.sideBySide);
		} catch (error) {
			finish();
			throw error;
		}

		if (!open) {
			finish();
			return;
		}
		open.then(finish, error => {
			finish();
			onUnexpectedError(error);
		});
	}

	/**
	 * Re-runs an in-flight open for `session` with `preserveFocus`, so the rename
	 * editor a double-click just opened keeps keyboard focus.
	 */
	private preservePendingOpenFocus(session: ISession): void {
		const request = this.pendingOpenRequest;
		if (!request || !isEqual(request.session.resource, session.resource)) {
			return;
		}
		request.preserveFocus = true;
		this.invokeOpenRequest(request);
	}

	beginRenameSession(session: ISession): boolean {
		// Resolve against the tree's own elements: the caller may hold a stale
		// `ISession` from before a refresh, and the renderer keys its editor off
		// the instance the tree actually rendered.
		const target = this.findTreeElement((element): element is ISession => isSessionItem(element) && isEqual(element.resource, session.resource));
		if (!target) {
			return false;
		}
		// F2 can target a row scrolled out of view; the editor has to be on screen.
		if (this.tree.getRelativeTop(target) === null) {
			this.tree.reveal(target, 0.5);
		}
		return this._sessionRenderer.beginRename(target);
	}

	private findTreeElement<T extends SessionListItem>(predicate: (element: SessionListItem) => element is T): T | undefined {
		const visit = (nodes: readonly ITreeNode<SessionListItem | null, FuzzyScore>[]): T | undefined => {
			for (const node of nodes) {
				if (node.element && predicate(node.element)) {
					return node.element;
				}
				const match = visit(node.children);
				if (match) {
					return match;
				}
			}
			return undefined;
		};
		return visit(this.tree.getNode().children);
	}

	addSessionsToGroup(sessions: ISession[], groupId: string, target?: ISession, position?: 'before' | 'after'): void {
		const groupSessions = sessions.filter(session => !session.isArchived.get());
		for (const session of groupSessions) {
			this._sessionGroupsService.addToGroup(session.sessionId, groupId);
		}
		if (target && position) {
			this.reorderSessions(groupSessions, target, position);
		}
	}

	private commitGroupEdit(group: ISessionGroup, name: string): void {
		this._editingGroupId = undefined;
		const trimmed = name.trim();
		if (trimmed) {
			this._sessionGroupsService.renameGroup(group.id, trimmed);
		}
		this.update();
	}

	private cancelGroupEdit(_group: ISessionGroup): void {
		this._editingGroupId = undefined;
		this.update();
	}

	/**
	 * Reorder a top-level header (group or workspace section) so it lands
	 * before/after the target header. The new order is persisted to the
	 * section-order service. When the dragged header is a workspace it is also
	 * promoted so it stays visible (escapes the "+N more workspaces" capping).
	 */
	private reorderSection(draggedId: string, targetId: string, position: 'before' | 'after', isWorkspace: boolean): void {
		this._sessionSectionOrderService.reorder(this._topLevelOrder, draggedId, targetId, position, isWorkspace ? draggedId : undefined);
	}

	/**
	 * Groups in their current top-to-bottom display order. Groups are fully
	 * user-managed (see {@link ISessionSectionOrderService}); the order defaults
	 * to newest-first and is shared with the list. Used to keep the "Add to
	 * Group" / "Move to Group" menu consistent with the rendered order.
	 */
	getGroupsInDisplayOrder(): ISessionGroup[] {
		const groups = this._sessionGroupsService.getGroups();
		const byId = new Map<string, ISessionGroup>(groups.map(g => [`group:${g.id}`, g]));
		const defaultIds = [...groups]
			.sort((a, b) => b.createdAt - a.createdAt)
			.map(g => `group:${g.id}`);
		return this._sessionSectionOrderService.resolveOrder(defaultIds)
			.map(id => byId.get(id))
			.filter((g): g is ISessionGroup => !!g);
	}

	/**
	 * The set of top-level reorder identities that currently exist (every group,
	 * plus every workspace label present across all sessions, regardless of
	 * grouping mode or capping). Used to garbage-collect stale manual order and
	 * promotion entries.
	 */
	private liveSectionOrderIds(): Set<string> {
		const ids = new Set<string>();
		for (const group of this._sessionGroupsService.getGroups()) {
			ids.add(`group:${group.id}`);
		}
		for (const session of this.sessions) {
			ids.add(`workspace:${sessionWorkspaceLabel(session)}`);
		}
		return ids;
	}

	private setDropTargetHeader(header: ISessionDropTargetHeader | undefined): void {
		const current = this._dropTargetHeader;
		if (current?.kind === header?.kind && current?.id === header?.id) {
			this.toggleDropTargetHeader(header, header !== undefined);
			return;
		}
		this.toggleDropTargetHeader(current, false);
		this._dropTargetHeader = header;
		this.toggleDropTargetHeader(header, true);
	}

	private toggleDropTargetHeader(header: ISessionDropTargetHeader | undefined, active: boolean): void {
		if (!header) {
			return;
		}
		if (header.kind === 'group') {
			this._groupRenderer.setDropTarget(header.id, active);
		} else {
			this._sectionRenderer.setDropTarget(header.id, active);
		}
	}

	private getMultiSelectedSessions(session: ISession): ISession[] {
		const selection = this.tree.getSelection().filter((s): s is ISession => !!s && isSessionItem(s));
		return selection.includes(session) ? [session, ...selection.filter(s => s !== session)] : [session];
	}

	private onContextMenu(e: ITreeContextMenuEvent<SessionListItem | null>): void {
		const element = e.element;
		if (!element || isSessionSection(element) || isSessionShowMore(element)) {
			return;
		}

		if (isSessionGroupItem(element)) {
			this.showGroupContextMenu(element, e.anchor);
			return;
		}

		const selectedSessions = this.getMultiSelectedSessions(element);

		const inGroup = this._sessionGroupsService.getGroupOfSession(element.sessionId) !== undefined;
		const contextOverlay: [string, boolean | string][] = [
			[IsSessionPinnedContext.key, this.isSessionPinned(element)],
			[SessionIsArchivedContext.key, element.isArchived.get()],
			[SessionIsReadContext.key, this.isSessionRead(element)],
			[SessionItemHasBranchNameContext.key, !!element.workspace.get()?.folders[0]?.gitRepository?.branchName?.trim()],
			[SessionItemInGroupContext.key, inGroup],
			[SessionTypeContext.key, element.sessionType],
			[SessionProviderIdContext.key, element.providerId],
			[SessionSupportsRenameContext.key, element.capabilities.supportsRename ?? false],
			[SessionSupportsDeleteContext.key, element.capabilities.supportsDelete ?? false],
		];

		const disposables = new DisposableStore();
		const menu = disposables.add(this.menuService.createMenu(SessionItemContextMenuId, this.contextKeyService.createOverlay(contextOverlay)));

		// Extension contributions on this menu need a marshalled AgentSessionContext arg; built-in actions take ISession[].
		const marshalledArg = {
			$mid: MarshalledId.AgentSessionContext,
			session: { resource: element.resource },
			sessions: selectedSessions.map(s => ({ resource: s.resource })),
		};
		const wrapAction = (action: IAction): IAction => {
			// "Rename..." from the row's own context menu edits in place rather than
			// opening the prompt; the command keeps its prompt for every other caller.
			if (action.id === RENAME_SESSION_COMMAND_ID) {
				return toAction({
					id: action.id,
					label: action.label,
					class: action.class,
					enabled: action.enabled,
					tooltip: action.tooltip,
					checked: action.checked,
					run: () => this.beginRenameSession(element),
				});
			}
			if (!(action instanceof MenuItemAction) || !action.item.source) {
				return action;
			}
			return toAction({
				id: action.id,
				label: action.label,
				class: action.class,
				enabled: action.enabled,
				tooltip: action.tooltip,
				checked: action.checked,
				run: () => this.commandService.executeCommand(action.id, marshalledArg),
			});
		};

		const baseActions = Separator.join(...menu.getActions({ arg: selectedSessions, shouldForwardArgs: true }).map(([, actions]) => actions.map(wrapAction)));
		const groupActions = this.getGroupSessionActions(selectedSessions);
		const actions = groupActions.length > 0 ? [...baseActions, new Separator(), ...groupActions] : baseActions;
		if (actions.length === 0) {
			disposables.dispose();
			return;
		}

		this.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => e.anchor,
			getKeyBinding: (action) => this.keybindingService.lookupKeybinding(action.id) ?? undefined,
			onHide: () => disposables.dispose(),
		});
	}

	/**
	 * Build the group-related context menu actions for the given session(s):
	 * "Create Group", an "Add to Group"/"Move to Group" submenu listing the
	 * groups in display order, and "Remove from Group" when applicable.
	 */
	private getGroupSessionActions(selected: ISession[]): IAction[] {
		const actions: IAction[] = [];
		if (selected.some(session => session.isArchived.get())) {
			return actions;
		}

		actions.push(toAction({
			id: 'sessions.createGroup',
			label: localize('createGroupAction', "Create Group"),
			run: () => this.createGroupFromSessions(selected),
		}));

		const currentGroupIds = new Set(selected.map(s => this._sessionGroupsService.getGroupOfSession(s.sessionId)));
		const currentGroupId = currentGroupIds.size === 1 ? [...currentGroupIds][0] : undefined;

		const targetGroups = this.getGroupsInDisplayOrder().filter(g => g.id !== currentGroupId);
		if (targetGroups.length > 0) {
			const subActions = targetGroups.map(g => toAction({
				id: `sessions.addToGroup.${g.id}`,
				label: g.name,
				run: () => this.addSessionsToGroup(selected, g.id),
			}));
			const label = currentGroupId !== undefined ? localize('moveToGroupAction', "Move to Group") : localize('addToGroupAction', "Add to Group");
			actions.push(new SubmenuAction('sessions.addToGroupSubmenu', label, subActions));
		}

		if (currentGroupId !== undefined) {
			actions.push(toAction({
				id: 'sessions.removeFromGroup',
				label: localize('removeFromGroupAction', "Remove from Group"),
				run: () => {
					for (const session of selected) {
						this._sessionGroupsService.removeFromGroup(session.sessionId);
					}
				},
			}));
		}

		return actions;
	}

	private showGroupContextMenu(groupItem: ISessionGroupItem, anchor: ITreeContextMenuEvent<SessionListItem>['anchor']): void {
		const actions: IAction[] = [
			toAction({
				id: 'sessions.renameGroupAction',
				label: localize('renameGroupAction', "Rename..."),
				run: () => this.beginRenameGroup(groupItem.group.id),
			}),
			toAction({
				id: 'sessions.deleteGroupAction',
				label: localize('deleteGroupAction', "Delete Group"),
				run: () => this._sessionGroupsService.deleteGroup(groupItem.group.id),
			}),
		];
		this.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => anchor,
		});
	}

	resetSectionCollapseState(): void {
		this.storageService.remove(SessionsList.SECTION_COLLAPSE_STATE_KEY, StorageScope.PROFILE);
	}

	// -- Pinning --

	pinSession(session: ISession): void {
		this._sessionsListModelService.pinSession(session);
	}

	private pinSessions(sessions: ISession[], target?: ISession, position?: 'before' | 'after'): void {
		const pinnable = sessions.filter(session => !session.isArchived.get());
		for (const session of pinnable) {
			this._sessionsListModelService.pinSession(session);
		}
		if (target && position) {
			this.reorderSessions(pinnable, target, position);
		}
	}

	unpinSession(session: ISession): void {
		this._sessionsListModelService.unpinSession(session);
	}

	isSessionPinned(session: ISession): boolean {
		return this._sessionsListModelService.isSessionPinned(session);
	}

	// -- Read/Unread --

	markRead(session: ISession): void {
		this._sessionsListModelService.markRead(session);
	}

	markUnread(session: ISession): void {
		this._sessionsListModelService.markUnread(session);
	}

	isSessionRead(session: ISession): boolean {
		return this._sessionsListModelService.isSessionRead(session);
	}

	// -- Session type filtering --

	setSessionTypeExcluded(sessionTypeId: string, excluded: boolean): void {
		if (excluded) {
			this.excludedSessionTypes.add(sessionTypeId);
		} else {
			this.excludedSessionTypes.delete(sessionTypeId);
		}
		this.saveExcludedSessionTypes();
		this.update();
	}

	isSessionTypeExcluded(sessionTypeId: string): boolean {
		return this.excludedSessionTypes.has(sessionTypeId);
	}

	private loadExcludedSessionTypes(): Set<string> {
		const raw = this.storageService.get(SessionsList.EXCLUDED_TYPES_KEY, StorageScope.PROFILE);
		if (raw) {
			try {
				const arr = JSON.parse(raw);
				if (Array.isArray(arr)) {
					return new Set(arr);
				}
			} catch {
				// ignore corrupt data
			}
		}
		return new Set();
	}

	private saveExcludedSessionTypes(): void {
		if (this.excludedSessionTypes.size === 0) {
			this.storageService.remove(SessionsList.EXCLUDED_TYPES_KEY, StorageScope.PROFILE);
		} else {
			this.storageService.store(SessionsList.EXCLUDED_TYPES_KEY, JSON.stringify([...this.excludedSessionTypes]), StorageScope.PROFILE, StorageTarget.USER);
		}
	}

	// -- Status filtering --

	setStatusExcluded(status: SessionStatus, excluded: boolean): void {
		if (excluded) {
			this.excludedStatuses.add(status);
		} else {
			this.excludedStatuses.delete(status);
		}
		this.saveExcludedStatuses();
		this.update();
	}

	isStatusExcluded(status: SessionStatus): boolean {
		return this.excludedStatuses.has(status);
	}

	private loadExcludedStatuses(): Set<SessionStatus> {
		const raw = this.storageService.get(SessionsList.EXCLUDED_STATUSES_KEY, StorageScope.PROFILE);
		if (raw) {
			try {
				const arr = JSON.parse(raw);
				if (Array.isArray(arr)) {
					return new Set(arr);
				}
			} catch {
				// ignore corrupt data
			}
		}
		return new Set();
	}

	private saveExcludedStatuses(): void {
		if (this.excludedStatuses.size === 0) {
			this.storageService.remove(SessionsList.EXCLUDED_STATUSES_KEY, StorageScope.PROFILE);
		} else {
			this.storageService.store(SessionsList.EXCLUDED_STATUSES_KEY, JSON.stringify([...this.excludedStatuses]), StorageScope.PROFILE, StorageTarget.USER);
		}
	}

	// -- Archived / Read filtering --

	setExcludeArchived(exclude: boolean): void {
		this._excludeArchived = exclude;
		this.storageService.store(SessionsList.EXCLUDE_ARCHIVED_KEY, exclude, StorageScope.PROFILE, StorageTarget.USER);
		this.update();
	}

	isExcludeArchived(): boolean {
		return this._excludeArchived;
	}

	setExcludeRead(exclude: boolean): void {
		this._excludeRead = exclude;
		this.storageService.store(SessionsList.EXCLUDE_READ_KEY, exclude, StorageScope.PROFILE, StorageTarget.USER);
		this.update();
	}

	isExcludeRead(): boolean {
		return this._excludeRead;
	}

	resetFilters(): void {
		this.excludedSessionTypes.clear();
		this.saveExcludedSessionTypes();
		this.excludedStatuses.clear();
		this.saveExcludedStatuses();
		this._excludeArchived = true;
		this.storageService.store(SessionsList.EXCLUDE_ARCHIVED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		this._excludeRead = false;
		this.storageService.store(SessionsList.EXCLUDE_READ_KEY, false, StorageScope.PROFILE, StorageTarget.USER);
		this.workspaceGroupCapped = true;
		this.storageService.store(SessionsList.WORKSPACE_GROUP_CAPPED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		this.expandedSessionGroups.clear();
		this.expandedMoreFolders = false;
		this.update();
	}

	// Session group capping

	setWorkspaceGroupCapped(capped: boolean): void {
		this.workspaceGroupCapped = capped;
		this.storageService.store(SessionsList.WORKSPACE_GROUP_CAPPED_KEY, capped, StorageScope.PROFILE, StorageTarget.USER);
		if (capped) {
			this.expandedSessionGroups.clear();
		}
		this.update();
	}

	isWorkspaceGroupCapped(): boolean {
		return this.workspaceGroupCapped;
	}

	setOpenWindowSourceFolder(folder: URI | undefined): void {
		const before = this.openWindowSourceFolder?.toString();
		const after = folder?.toString();
		if (before === after) {
			return;
		}
		this.openWindowSourceFolder = folder;
		this.update();
	}

	collapseAllSections(): void {
		this.suspendCollapseStatePersistence = true;
		try {
			this.tree.collapseAll();
		} finally {
			this.suspendCollapseStatePersistence = false;
		}
		this.saveBulkCollapseState(true);
	}

	// -- Section collapse persistence --

	private getSavedCollapseState(sectionId: string): boolean | undefined {
		const raw = this.storageService.get(SessionsList.SECTION_COLLAPSE_STATE_KEY, StorageScope.PROFILE);
		if (raw) {
			try {
				const state: Record<string, boolean> = JSON.parse(raw);
				if (typeof state[sectionId] === 'boolean') {
					return state[sectionId];
				}
			} catch {
				// ignore corrupt data
			}
		}
		return undefined;
	}

	private saveSectionCollapseState(sectionId: string, collapsed: boolean): void {
		let state: Record<string, boolean> = {};
		const raw = this.storageService.get(SessionsList.SECTION_COLLAPSE_STATE_KEY, StorageScope.PROFILE);
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
					state = parsed;
				}
			} catch {
				// ignore corrupt data
			}
		}
		state[sectionId] = collapsed;
		this.storageService.store(SessionsList.SECTION_COLLAPSE_STATE_KEY, JSON.stringify(state), StorageScope.PROFILE, StorageTarget.USER);
	}

	private saveBulkCollapseState(collapsed: boolean): void {
		const state: Record<string, boolean> = {};
		for (const child of this.tree.getNode(null).children) {
			if (child.element && isSessionSection(child.element)) {
				state[child.element.id] = collapsed;
			}
		}
		this.storageService.store(SessionsList.SECTION_COLLAPSE_STATE_KEY, JSON.stringify(state), StorageScope.PROFILE, StorageTarget.USER);
	}

}

//#endregion

//#region Approval Helpers

/**
 * The vertical space a pending approval contributes to its row, or `0` when
 * there is none. Tracked by the renderer so a row's virtualized height is
 * refreshed whenever it changes, including when one approval is replaced
 * directly by another with a different line count.
 */
function approvalRowHeightFor(info: IAgentSessionApprovalInfo | undefined): number {
	return info ? SessionItemRenderer.getApprovalRowHeight(info.label) : 0;
}

function getFirstApprovalAcrossChats(approvalModel: AgentSessionApprovalModel, session: ISession, reader: IReader | undefined,): IAgentSessionApprovalInfo | undefined {
	let oldest: IAgentSessionApprovalInfo | undefined;
	for (const chat of session.chats.read(reader)) {
		const approval = approvalModel.getApproval(chat.resource).read(reader);
		if (approval && (!oldest || approval.since.getTime() < oldest.since.getTime())) {
			oldest = approval;
		}
	}
	return oldest;
}

//#endregion

//#region Folder Matching

function sessionMatchesFolder(session: ISession, folder: URI): boolean {
	const workspace = session.workspace.get();
	if (!workspace) {
		return false;
	}
	const folderStr = folder.toString();
	for (const folder of workspace.folders) {
		if (folder.workingDirectory?.toString() === folderStr || folder.root.toString() === folderStr) {
			return true;
		}
	}
	return false;
}

//#endregion

//#region Sorting & Grouping Helpers

export function sortSessions(sessions: ISession[], sorting: SessionsSorting, getSortKey?: (session: ISession, sorting: SessionsSorting) => number): ISession[] {
	const key = getSortKey ?? defaultSortKey;
	return [...sessions].sort((a, b) => key(b, sorting) - key(a, sorting));
}

export interface ISessionLimitResult {
	readonly sessions: readonly ISession[];
	readonly showMore: ISessionShowMore | undefined;
}

export function limitSessionsForList(
	sessions: readonly ISession[],
	limit: number,
	options: { readonly enabled: boolean; readonly expanded: boolean; readonly sectionId: string; readonly sectionLabel: string },
): ISessionLimitResult {
	if (!options.enabled || sessions.length <= limit) {
		return { sessions, showMore: undefined };
	}

	if (options.expanded) {
		return {
			sessions,
			showMore: {
				showMore: true,
				kind: 'sessions',
				mode: 'less',
				sectionId: options.sectionId,
				sectionLabel: options.sectionLabel,
				remainingCount: 0,
			},
		};
	}

	return {
		sessions: sessions.slice(0, limit),
		showMore: {
			showMore: true,
			kind: 'sessions',
			mode: 'more',
			sectionId: options.sectionId,
			sectionLabel: options.sectionLabel,
			remainingCount: sessions.length - limit,
		},
	};
}

function defaultSortKey(session: ISession, sorting: SessionsSorting): number {
	if (sorting === SessionsSorting.Updated) {
		return session.updatedAt.get().getTime();
	}
	return session.createdAt.getTime();
}

export interface IReorderSortInput {
	/** Dragged session ids in display (descending-key) order. */
	readonly draggedIds: readonly string[];
	/** Natural sort key per dragged session (same order as {@link draggedIds}). */
	readonly naturalKeys: readonly number[];
	/** Effective key of the neighbour above the drop point (higher), if any. */
	readonly aboveKey: number | undefined;
	/** Effective key of the neighbour below the drop point (lower), if any. */
	readonly belowKey: number | undefined;
	/** Current time, used when dropping above the first session. */
	readonly now: number;
	/** Spacing used when stepping past an open boundary. */
	readonly fallbackStep: number;
}

/**
 * Compute the manual sort-override changes for a reorder drop. Assigns the
 * dragged block strictly-descending synthetic keys spread between the
 * surrounding neighbours, except when the sessions' natural keys already sort
 * them into the dropped slot — in which case any existing override is dropped.
 */
export function computeReorderSortChanges(input: IReorderSortInput): { set: Map<string, number>; clear: string[] } {
	const { draggedIds, naturalKeys, aboveKey, belowKey, now, fallbackStep } = input;
	const count = draggedIds.length;

	// "Drop the fake value": when every dragged session's natural key already
	// lands strictly inside the surrounding gap (and in descending display
	// order), clear overrides instead of storing synthetic keys.
	const upperFit = aboveKey ?? Number.POSITIVE_INFINITY;
	const lowerFit = belowKey ?? Number.NEGATIVE_INFINITY;
	let naturalFits = true;
	for (let i = 0; i < count; i++) {
		if (!(naturalKeys[i] < upperFit && naturalKeys[i] > lowerFit)) {
			naturalFits = false;
			break;
		}
		if (i > 0 && !(naturalKeys[i] < naturalKeys[i - 1])) {
			naturalFits = false;
			break;
		}
	}

	const set = new Map<string, number>();
	const clear: string[] = [];
	if (naturalFits) {
		for (const id of draggedIds) {
			clear.push(id);
		}
	} else {
		// Spread `count` strictly-descending synthetic keys across the gap. An
		// open top boundary uses the current time so the block sorts to the very
		// top; an open bottom boundary steps below the last key.
		const upper = aboveKey ?? now;
		const lower = belowKey ?? (upper - (count + 1) * fallbackStep);
		const step = (upper - lower) / (count + 1);
		for (let i = 0; i < count; i++) {
			set.set(draggedIds[i], upper - (i + 1) * step);
		}
	}
	return { set, clear };
}

export function groupSessionsForList(
	sessions: ISession[],
	grouping: SessionsGrouping,
	sorting: SessionsSorting,
	isSessionPinned: (session: ISession) => boolean,
	getSortKey?: (session: ISession, sorting: SessionsSorting) => number,
): ISessionSection[] {
	const sorted = sortSessions(sessions, sorting, getSortKey);

	// Archived always wins over pinned so done sessions stay grouped together.
	const pinned: ISession[] = [];
	const archived: ISession[] = [];
	const regular: ISession[] = [];
	for (const session of sorted) {
		if (session.isArchived.get()) {
			archived.push(session);
		} else if (isSessionPinned(session)) {
			pinned.push(session);
		} else {
			regular.push(session);
		}
	}

	const sections: ISessionSection[] = [];
	if (pinned.length > 0) {
		sections.push({ id: 'pinned', label: localize('pinned', "Pinned"), sessions: pinned });
	}

	sections.push(...(grouping === SessionsGrouping.Workspace
		? groupByWorkspace(regular)
		: groupByDate(regular, sorting, getSortKey)));

	if (archived.length > 0) {
		sections.push({ id: 'archived', label: localize('archived', "Done"), sessions: archived });
	}

	return sections;
}

/** The workspace group label a session belongs to (matches {@link groupByWorkspace}). */
function sessionWorkspaceLabel(session: ISession): string {
	return session.workspace.get()?.label || localize('unknown', "Unknown");
}

export function groupByWorkspace(sessions: ISession[]): ISessionSection[] {
	const groups = new Map<string, ISession[]>();
	for (const session of sessions) {
		const label = sessionWorkspaceLabel(session);
		let group = groups.get(label);
		if (!group) {
			group = [];
			groups.set(label, group);
		}
		group.push(session);
	}

	const unknownWorkspaceLabel = localize('unknown', "Unknown");
	const order = [...groups.keys()]
		.filter(k => k !== unknownWorkspaceLabel)
		.sort((a, b) => a.localeCompare(b));

	const result: ISessionSection[] = order.map(label => ({
		id: `workspace:${label}`,
		label,
		sessions: groups.get(label)!,
	}));

	// "Unknown Workspace" always at the bottom
	const unknownWorkspace = groups.get(unknownWorkspaceLabel);
	if (unknownWorkspace) {
		result.push({ id: `workspace:${unknownWorkspaceLabel}`, label: unknownWorkspaceLabel, sessions: unknownWorkspace });
	}

	return result;
}

/**
 * How recently a session must have been updated to stay in "Today" even though
 * it was created earlier. Only applies when sorting by creation date, where the
 * bucket would otherwise be decided by a timestamp that never moves.
 */
const RECENTLY_UPDATED_SESSION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function groupByDate(sessions: ISession[], sorting: SessionsSorting, getSortKey?: (session: ISession, sorting: SessionsSorting) => number): ISessionSection[] {
	const key = getSortKey ?? defaultSortKey;
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfYesterday = startOfToday - 86_400_000;
	const startOfWeek = startOfToday - 7 * 86_400_000;
	const recentlyUpdatedThreshold = now.getTime() - RECENTLY_UPDATED_SESSION_THRESHOLD_MS;

	const today: ISession[] = [];
	const yesterday: ISession[] = [];
	const week: ISession[] = [];
	const older: ISession[] = [];

	for (const session of sessions) {
		const time = key(session, sorting);
		// A long-running session that just produced output must not sit in
		// "Older" because it was created two weeks ago.
		const wasRecentlyUpdated = sorting === SessionsSorting.Created && session.updatedAt.get().getTime() >= recentlyUpdatedThreshold;

		if (time >= startOfToday || wasRecentlyUpdated) {
			today.push(session);
		} else if (time >= startOfYesterday) {
			yesterday.push(session);
		} else if (time >= startOfWeek) {
			week.push(session);
		} else {
			older.push(session);
		}
	}

	const sections: ISessionSection[] = [];
	const addGroup = (id: string, label: string, groupSessions: ISession[]) => {
		if (groupSessions.length > 0) {
			sections.push({ id, label, sessions: groupSessions });
		}
	};

	addGroup('today', localize('today', "Today"), today);
	addGroup('yesterday', localize('yesterday', "Yesterday"), yesterday);
	addGroup('thisWeek', localize('lastSevenDays', "Last 7 Days"), week);
	addGroup('older', localize('older', "Older"), older);

	return sections;
}

//#endregion
