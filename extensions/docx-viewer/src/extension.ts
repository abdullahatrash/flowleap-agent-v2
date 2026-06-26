/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocxEditorProvider } from './custom_editor';

export function activate(context: vscode.ExtensionContext) {
	// Create the custom editor provider instance
	const editorProvider = new DocxEditorProvider();

	// Register the custom editor provider
	context.subscriptions.push(vscode.window.registerCustomEditorProvider('flowleap.docxViewer', editorProvider, {
		webviewOptions: {
			retainContextWhenHidden: true
		},
		supportsMultipleEditorsPerDocument: false
	}));

	// Register configuration command
	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.openConfig', () => {
		vscode.commands.executeCommand('workbench.action.openSettings', 'docxViewer');
	}));

	// Register zoom commands
	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.zoomIn', () => {
		editorProvider.handleZoomIn();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.zoomOut', () => {
		editorProvider.handleZoomOut();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.resetZoom', () => {
		editorProvider.handleResetZoom();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.toggleOutline', () => {
		editorProvider.handleToggleOutline();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.toggleTheme', () => {
		editorProvider.handleToggleTheme();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.toggleToolbar', () => {
		editorProvider.handleToggleToolbar();
	}));

	// Register status bar update command
	context.subscriptions.push(vscode.commands.registerCommand('docxViewer.updateStatusBar', () => {
		updateStatusBar();
	}));

	// Register status bar item to show current zoom level
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'docxViewer.resetZoom';
	statusBarItem.tooltip = 'Click to reset zoom';

	// Function to update status bar
	function updateStatusBar() {
		const activeEditor = vscode.window.activeTextEditor;
		const isDocxEditor = activeEditor &&
			(activeEditor.document.uri.scheme === 'vscode-webview' ||
				activeEditor.document.fileName.endsWith('.docx') ||
				activeEditor.document.fileName.endsWith('.odt'));

		if (isDocxEditor || editorProvider.hasActiveWebviewPanels()) {
			const zoom = Math.round(editorProvider.getCurrentZoom() * 100);
			statusBarItem.text = `$(zoom-in) ${zoom}%`;
			statusBarItem.show();
		} else {
			statusBarItem.hide();
		}
	}

	// Update status bar when active editor changes
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
		updateStatusBar();
	}));

	// Update status bar when webview panel becomes active
	context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
		updateStatusBar();
	}));

	context.subscriptions.push(statusBarItem);

	console.log('Document Viewer extension activated');
}

export function deactivate() {
	console.log('Document Viewer extension deactivated');
}
