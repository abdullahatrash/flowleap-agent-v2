/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ErrorNoTelemetry } from '../../../util/vs/base/common/errors';

export class NotSignedUpError extends Error { }
export class SubscriptionExpiredError extends Error { }
export class ContactSupportError extends Error { }
export class EnterpriseManagedError extends Error { }
export class InvalidTokenError extends Error { }
export class RateLimitedError extends Error { }
export class GitHubLoginFailedError extends ErrorNoTelemetry { }
