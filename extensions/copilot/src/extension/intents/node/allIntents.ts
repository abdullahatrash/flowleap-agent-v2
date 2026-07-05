/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { SyncDescriptor } from '../../../util/vs/platform/instantiation/common/descriptors';
import { InlineChatIntent } from '../../inlineChat2/node/inlineChatIntent';
import { IntentRegistry } from '../../prompt/node/intentRegistry';
import { AgentIntent } from './agentIntent';
import { AskAgentIntent } from './askAgentIntent';
import { EditCodeIntent } from './editCodeIntent';
import { NotebookEditorIntent } from './notebookEditorIntent';
import { TerminalIntent } from './terminalIntent';
import { UnknownIntent } from './unknownIntent';

IntentRegistry.setIntents([
	new SyncDescriptor(EditCodeIntent),
	new SyncDescriptor(AgentIntent),
	new SyncDescriptor(TerminalIntent),
	new SyncDescriptor(UnknownIntent),
	new SyncDescriptor(AskAgentIntent),
	new SyncDescriptor(NotebookEditorIntent),
	new SyncDescriptor(InlineChatIntent),
]);
