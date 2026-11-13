/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, addDisposableListener, append, EventType } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { KeyCodeChord, ResolvedKeybinding } from '../../../../../base/common/keybindings.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh, OS } from '../../../../../base/common/platform.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyChangeEvent, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { MockContextKeyService, MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { INotificationService, NotificationMessage } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { getIconRegistry } from '../../../../../platform/theme/common/iconRegistry.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { EditorGroupWatermark } from '../../../../browser/parts/editor/editorGroupWatermark.js';
import { TestContextService } from '../../../common/workbenchTestServices.js';
import { workbenchInstantiationService } from '../../workbenchTestServices.js';

suite('EditorGroupWatermark', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let container: HTMLElement;
	let configurationService: TestConfigurationService;
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let keybindings: Map<string, ResolvedKeybinding>;
	let keybindingLookups: string[];
	let keybindingsChanged: Emitter<void>;
	let workbenchState: WorkbenchState;
	let chatEnabled: boolean;
	let executedCommands: string[];
	let commandError: Error | undefined;
	let notificationReceived: Emitter<NotificationMessage>;
	let contextChanged: Emitter<IContextKeyChangeEvent>;

	function changeContext(...keys: string[]): void {
		contextChanged.fire({ affectsSome: affected => keys.some(key => affected.has(key)), allKeysContainedIn: () => false });
	}

	function keybinding(keyCode: KeyCode): ResolvedKeybinding {
		return new USLayoutResolvedKeybinding([new KeyCodeChord(!isMacintosh, false, false, isMacintosh, keyCode)], OS);
	}

	function render(): void {
		disposables.add(instantiationService.createInstance(EditorGroupWatermark, container));
	}

	function rows() {
		return [...container.querySelectorAll('.watermark-entry')].map(row => ({
			label: row.querySelector('.watermark-label')?.textContent,
			icon: row.querySelector('.codicon')?.className,
			iconHidden: row.querySelector('.codicon')?.getAttribute('aria-hidden'),
			keybinding: row.querySelector('.monaco-keybinding')?.getAttribute('aria-label'),
		}));
	}

	function pressKey(target: HTMLElement, key: string, keyCode: number): void {
		for (const type of [EventType.KEY_DOWN, EventType.KEY_UP]) {
			const event = new KeyboardEvent(type, { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true });
			// StandardKeyboardEvent reads the legacy keyCode, which some constructors ignore.
			Object.defineProperties(event, {
				keyCode: { value: keyCode },
				which: { value: keyCode },
			});
			target.dispatchEvent(event);
		}
	}

	setup(() => {
		container = append(document.body, $('.editor-group-container.empty'));
		disposables.add(toDisposable(() => container.remove()));
		configurationService = new TestConfigurationService({ workbench: { tips: { enabled: true } } });
		disposables.add(configurationService.onDidChangeConfigurationEmitter);
		instantiationService = workbenchInstantiationService({ configurationService: () => configurationService }, disposables);
		keybindingsChanged = disposables.add(new Emitter<void>());
		keybindings = new Map([
			['workbench.action.chat.open', keybinding(KeyCode.KeyI)],
			['workbench.action.showCommands', keybinding(KeyCode.KeyP)],
			['workbench.action.openSettings', keybinding(KeyCode.Comma)],
		]);
		keybindingLookups = [];
		workbenchState = WorkbenchState.FOLDER;
		chatEnabled = true;
		executedCommands = [];
		commandError = undefined;
		notificationReceived = disposables.add(new Emitter<NotificationMessage>());
		instantiationService.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string): Promise<T | undefined> {
				executedCommands.push(id);
				if (commandError) {
					throw commandError;
				}
				return undefined;
			}
		});
		instantiationService.stub(INotificationService, new class extends TestNotificationService {
			override error(error: NotificationMessage) {
				notificationReceived.fire(error);
				return super.error(error);
			}
		});
		instantiationService.stub(IKeybindingService, new class extends MockKeybindingService {
			override get onDidUpdateKeybindings() { return keybindingsChanged.event; }
			override lookupKeybinding(id: string) {
				keybindingLookups.push(id);
				return keybindings.get(id);
			}
		});
		contextChanged = disposables.add(new Emitter<IContextKeyChangeEvent>());
		instantiationService.stub(IContextKeyService, new class extends MockContextKeyService {
			override get onDidChangeContext() { return contextChanged.event; }
			override contextMatchesRules() { return chatEnabled; }
		});
		instantiationService.stub(IWorkspaceContextService, new class extends TestContextService {
			override getWorkbenchState() { return workbenchState; }
		});

		// FlowLeap (B5c): the letterpress lists Open Chat / Show Files / Search Files / Find in Files / Show All
		// Commands in a workspace and Open Chat / Open Recent / Show Files / Search Files in an empty window,
		// with no keybinding filter.
		for (const id of [
			...keybindings.keys(),
			'workbench.view.explorer',
			'workbench.action.quickOpen',
			'workbench.action.files.openFile',
			'workbench.action.files.openFolder',
			'workbench.action.files.openFileFolder',
			'workbench.action.openRecent',
			'workbench.action.files.newUntitledFile',
			'workbench.action.findInFiles',
			'workbench.action.terminal.toggleTerminal',
			'workbench.action.debug.start',
		]) {
			disposables.add(CommandsRegistry.registerCommand(id, () => { }));
		}
	});

	test('renders shortcut labels with decorative icons and standard keybinding labels', () => {
		render();

		assert.deepStrictEqual(rows(), [
			{ label: 'Open Chat', icon: 'codicon codicon-watermark-chat watermark-icon', iconHidden: 'true', keybinding: keybindings.get('workbench.action.chat.open')?.getAriaLabel() },
			{ label: 'Show Files', icon: 'codicon codicon-watermark-explorer watermark-icon', iconHidden: 'true', keybinding: undefined },
			{ label: 'Search Files', icon: 'codicon codicon-watermark-quick-open watermark-icon', iconHidden: 'true', keybinding: undefined },
			{ label: 'Find in Files', icon: 'codicon codicon-watermark-find-in-files watermark-icon', iconHidden: 'true', keybinding: undefined },
			{ label: 'Show All Commands', icon: 'codicon codicon-watermark-commands watermark-icon', iconHidden: 'true', keybinding: keybindings.get('workbench.action.showCommands')?.getAriaLabel() },
		]);
	});

	test('uses consistent Chat and Settings glyphs and a command-picker glyph distinct from Terminal', () => {
		const registry = getIconRegistry();

		assert.deepStrictEqual({
			chat: registry.getIcon('watermark-chat')?.defaults,
			commands: registry.getIcon('watermark-commands')?.defaults,
			settings: registry.getIcon('watermark-settings')?.defaults,
			terminal: registry.getIcon('watermark-terminal')?.defaults,
		}, {
			chat: Codicon.chatSparkle,
			commands: Codicon.listSelection,
			settings: Codicon.settings,
			terminal: Codicon.terminal,
		});
	});

	test('clicking each shortcut executes its command', () => {
		render();
		for (const row of container.querySelectorAll<HTMLElement>('.watermark-entry')) {
			row.click();
		}

		assert.deepStrictEqual(executedCommands, ['workbench.action.chat.open', 'workbench.view.explorer', 'workbench.action.quickOpen', 'workbench.action.findInFiles', 'workbench.action.showCommands']);
	});

	test('renders each shortcut as a single interactive anchor without nested anchors', () => {
		render();

		assert.deepStrictEqual({
			anchors: container.querySelectorAll('.watermark-box a').length,
			nestedAnchors: container.querySelectorAll('.watermark-box a a').length,
			actionLabels: [...container.querySelectorAll('.watermark-box .action-label')].map(label => label.matches('a.watermark-entry[role="button"]')),
		}, {
			anchors: 5,
			nestedAnchors: 0,
			actionLabels: [true, true, true, true, true],
		});
	});

	test('clicking shortcut contents executes the command exactly once per click', () => {
		render();
		for (const selector of ['.watermark-icon', '.watermark-label', '.watermark-keybinding']) {
			container.querySelector<HTMLElement>(`.watermark-entry ${selector}`)!.click();
		}

		assert.deepStrictEqual(executedCommands, Array(3).fill('workbench.action.chat.open'));
	});

	test('exposes accessible button labels and a keyboard-reachable toolbar', () => {
		render();

		assert.deepStrictEqual({
			toolbarLabel: container.querySelector('.watermark-box [role="toolbar"]')?.getAttribute('aria-label'),
			buttons: [...container.querySelectorAll<HTMLElement>('.watermark-entry')].map(row => ({
				role: row.getAttribute('role'),
				label: row.getAttribute('aria-label'),
				tabIndex: row.tabIndex,
			})),
		}, {
			toolbarLabel: 'Editor Shortcuts',
			buttons: [
				`Open Chat (${keybindings.get('workbench.action.chat.open')!.getAriaLabel()})`,
				'Show Files',
				'Search Files',
				'Find in Files',
				`Show All Commands (${keybindings.get('workbench.action.showCommands')!.getAriaLabel()})`,
			].map((label, index) => ({
				role: 'button',
				label,
				tabIndex: index === 0 ? 0 : -1,
			})),
		});
	});

	for (const [key, keyCode] of [['Enter', 13], [' ', 32]] as const) {
		test(`activates a shortcut with ${key === ' ' ? 'Space' : key}`, () => {
			render();
			const row = container.querySelector<HTMLElement>('.watermark-entry')!;
			row.focus();
			pressKey(row, 'Tab', 9);
			pressKey(row, key, keyCode);

			assert.deepStrictEqual(executedCommands, ['workbench.action.chat.open']);
		});
	}

	test('supports arrow-key navigation between shortcuts', () => {
		render();
		const rows = [...container.querySelectorAll<HTMLElement>('.watermark-entry')];
		rows[0].focus();
		pressKey(rows[0], 'Tab', 9);
		pressKey(rows[0], 'ArrowDown', 40);
		const nextFocused = document.activeElement === rows[1];
		pressKey(rows[1], 'ArrowUp', 38);

		assert.deepStrictEqual({ nextFocused, previousFocused: document.activeElement === rows[0], executedCommands }, {
			nextFocused: true,
			previousFocused: true,
			executedCommands: [],
		});
	});

	test('double-clicking a shortcut does not reach the empty editor group', () => {
		render();
		let doubleClicks = 0;
		disposables.add(addDisposableListener(container, EventType.DBLCLICK, () => doubleClicks++));
		container.querySelector('.watermark-entry')!.dispatchEvent(new MouseEvent(EventType.DBLCLICK, { bubbles: true, cancelable: true }));

		assert.strictEqual(doubleClicks, 0);
	});

	test('reports command failures through the notification service', async () => {
		render();
		commandError = new Error('Command failed');
		const notification = Event.toPromise(notificationReceived.event);
		container.querySelector<HTMLElement>('.watermark-entry')!.click();

		assert.strictEqual(await notification, commandError);
	});

	test('updates keybindings without duplicating rows or icons and keeps unbound shortcuts', () => {
		render();
		const updatedKeybinding = keybinding(KeyCode.KeyO);
		keybindings.set('workbench.action.chat.open', updatedKeybinding);
		keybindings.delete('workbench.action.showCommands');
		keybindingsChanged.fire();
		keybindingsChanged.fire();

		assert.deepStrictEqual({
			labels: rows().map(row => row.label),
			icons: container.querySelectorAll('.codicon').length,
			keybinding: rows()[0].keybinding,
			unbound: rows()[4].keybinding,
		}, {
			labels: ['Open Chat', 'Show Files', 'Search Files', 'Find in Files', 'Show All Commands'],
			icons: 5,
			keybinding: updatedKeybinding.getAriaLabel(),
			unbound: undefined,
		});
	});

	test('looks up each shortcut keybinding once per update', () => {
		render();
		keybindingLookups = [];
		keybindingsChanged.fire();

		assert.deepStrictEqual(keybindingLookups, [
			'workbench.action.chat.open',
			'workbench.view.explorer',
			'workbench.action.quickOpen',
			'workbench.action.findInFiles',
			'workbench.action.showCommands',
		]);
	});

	test('keeps chat visible without a chat-setup gate', () => {
		// FlowLeap (B5c): Open Chat carries no `when`, so the chat-setup context never hides it.
		chatEnabled = false;
		render();

		assert.deepStrictEqual(rows().map(row => row.label), ['Open Chat', 'Show Files', 'Search Files', 'Find in Files', 'Show All Commands']);
	});

	test('does not re-render for context changes that keep the visible shortcuts unchanged', () => {
		render();
		const before = [...container.querySelectorAll('.watermark-entry')];
		changeContext('someUnrelatedKey');
		changeContext('chatSetupHidden');

		assert.deepStrictEqual([...container.querySelectorAll('.watermark-entry')].map((row, index) => row === before[index]), [true, true, true, true, true]);
	});

	test('respects the tips setting when disabled and re-enabled', async () => {
		render();
		const setTipsEnabled = async (enabled: boolean) => {
			await configurationService.setUserConfiguration('workbench.tips.enabled', enabled);
			configurationService.onDidChangeConfigurationEmitter.fire({
				source: ConfigurationTarget.USER,
				affectedKeys: new Set(['workbench.tips.enabled']),
				change: { keys: ['workbench.tips.enabled'], overrides: [] },
				affectsConfiguration: key => key === 'workbench.tips.enabled',
			});
		};

		await setTipsEnabled(false);
		keybindingsChanged.fire();
		const hiddenRows = rows();
		await setTipsEnabled(true);

		assert.deepStrictEqual({ hiddenRows, labels: rows().map(row => row.label) }, {
			hiddenRows: [],
			labels: ['Open Chat', 'Show Files', 'Search Files', 'Find in Files', 'Show All Commands'],
		});
	});

	test('renders chat, recent, files and search icons in an empty window', () => {
		workbenchState = WorkbenchState.EMPTY;
		render();

		assert.deepStrictEqual(rows().map(row => row.icon), [
			'codicon codicon-watermark-chat watermark-icon',
			'codicon codicon-watermark-open-recent watermark-icon',
			'codicon codicon-watermark-explorer watermark-icon',
			'codicon codicon-watermark-quick-open watermark-icon',
		]);
	});

	for (const [id, icon, index] of [
		['workbench.action.quickOpen', 'watermark-quick-open', 2],
		['workbench.action.findInFiles', 'watermark-find-in-files', 3],
	] as const) {
		test(`renders the icon for ${id}`, () => {
			render();

			assert.strictEqual(rows()[index].icon, `codicon codicon-${icon} watermark-icon`);
		});
	}
});
