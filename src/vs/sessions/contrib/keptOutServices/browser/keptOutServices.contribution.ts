/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FlowLeap (PRD 0017 keep-out): the github, codeReview and automations contributions stay out of
// registration (no PR/CI/review UI, no automations entry points), but upstream's core Agents Window
// parts inject their services (sessions list, changes view, agent feedback, blocked sessions). This
// file registers the services only, so those parts can be created. The services stay inert for
// sessions without GitHub metadata or an automations-capable provider.

import { observableFromPromise } from '../../../../base/common/observable.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../../workbench/common/contributions.js';
import { IAutomationDialogService } from '../../../../workbench/contrib/chat/common/automations/automationDialogService.js';
import { IAutomationRunner } from '../../../../workbench/contrib/chat/common/automations/automationRunner.js';
import { IAutomationService } from '../../../../workbench/contrib/chat/common/automations/automationService.js';
import { AutomationDialogService } from '../../automations/browser/automationDialogService.js';
import { AutomationRunner } from '../../automations/browser/automationRunner.js';
import { ProviderAutomationService } from '../../automations/browser/providerAutomationService.js';
import { CodeReviewService, ICodeReviewService } from '../../codeReview/browser/codeReviewService.js';
import { GitHubService, IGitHubService } from '../../github/browser/githubService.js';
import { IPullRequestIconCache, PullRequestIconCache } from '../../github/browser/pullRequestIconCache.js';

registerSingleton(IGitHubService, GitHubService, InstantiationType.Delayed);
registerSingleton(IPullRequestIconCache, PullRequestIconCache, InstantiationType.Delayed);
registerSingleton(ICodeReviewService, CodeReviewService, InstantiationType.Delayed);

const initialProvidersSettled = observableFromPromise(
	Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).whenRestored.then(() => true)
).map(result => result.value === true);
registerSingleton(IAutomationService, new SyncDescriptor(ProviderAutomationService, [initialProvidersSettled], true));
registerSingleton(IAutomationRunner, AutomationRunner, InstantiationType.Delayed);
registerSingleton(IAutomationDialogService, AutomationDialogService, InstantiationType.Delayed);
