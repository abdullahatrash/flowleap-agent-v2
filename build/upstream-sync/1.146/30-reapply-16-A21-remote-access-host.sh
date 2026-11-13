#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-16-A21-remote-access-host. Re-applies PRD 0018 B3/B4 host seams: IConnectionTrackerService, IAgentHostManagementService and IAgentHostService gain setRemoteAccessHost and getRemoteAccessHostStatus; agentHostMain creates the RemoteAccessHostController on first use (appVersion = product.flowleapVersion, a brand-owned field); the Agents Window toggle moves to AgentsWindowMenus.TitleBarRightLayout; the Viewer agent host service follows the 1.146 base (webSocketEntriesSettingId instead of supportsWebSocketConnections, no IEnvironmentService). Applies patches/30-reapply-16-A21-remote-access-host.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-16-A21-remote-access-host.patch"
