/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Remote Access Viewer entry point (PRD 0018 B4, docs/remote-access/VIEWER.md).
//
// The plain web Agents Window plus the generic remote agent host provider,
// connected to one Host through the FlowLeap Relay. The Viewer boot page
// (`contrib/remoteAccess/browser/viewer/remoteAccessViewerBoot.ts`) signs in,
// picks the pair and calls `create` with `remoteAccessViewer` options.
// The desktop and the plain web entries do not import this file.

import './sessions.web.main.js';

// The generic remote agent host provider for WebSocket-kind entries. The
// Viewer's service publishes exactly one such entry: the pair's Host. One
// provider lists every agent the Host publishes.
import './contrib/providers/remoteAgentHost/browser/webSocketAgentHost.contribution.js';
import './contrib/providers/agentHost/browser/agentHostAgentPicker.js';
import './contrib/providers/agentHost/browser/openSubagentChat.js';

// Phone presentation of the chat input pickers (web only: phones never run
// the desktop build).
import './contrib/providers/agentHost/browser/mobile/mobileChatInputConfigPicker.js';
import './contrib/providers/agentHost/browser/mobile/mobileChatPhoneInputPresenter.js';

// The Viewer's remote agent host service and the workbench integration of a
// remote connection.
import './contrib/remoteAccess/browser/viewer/remoteAccessViewer.contribution.js';

import { create } from './browser/web.factory.js';
import { URI } from '../base/common/uri.js';

export {
	create,
	URI,
};
