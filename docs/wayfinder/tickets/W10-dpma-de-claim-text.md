---
id: W10
title: DPMAconnectPlus connector for authoritative DE claim/description text
type: task
status: open
assignee:
blocked-by: []
---

## Question

Add a connector to DPMAconnectPlus (SSL REST + weekly bulk; successor to DEPATISconnect) that
retrieves DE-national claim & description text by publication number, to serve as the DE source
of record behind the facade.

Graduated from [Source of record for US & DE claim/description full-text](W1-us-de-claim-text-source.md)
(see [research asset](../assets/W1-claim-text-source-research.md)). **Confirmed 2026-07-12:**
Google Patents BQ's `claims_localized`/`description_localized` are US-only (per the table DDL), so
BQ contributes **zero** DE full-text — DPMAconnectPlus is the *sole* DE source, not a fallback.
This makes W10 mandatory for any DE-market FTO. An existing Go client (`dpma-connect-plus`) can be
a reference.

### First, settle
- DPMA registration + credential storage (a `wayfinder:task`-style provisioning step may split out).
- Redistribution ToS for serving DE text via the backend facade (German patent text is public;
  confirm the terms).

### Scope boundary
*Retrieving* DE text by number is in scope. *Searching* DPMA for DE-only rights (Gebrauchsmuster
discovery) is **out of scope** for this map.

### Definition of done
A backend lookup returns DE claim + description text by publication number; wired into the
[country-code router](W9-facade-country-code-router.md) so `get_claims(DE…)` resolves.
