# Phase 2 query-quality dogfood (PRD 0012)

**Date:** 2026-08-12 (blocked run ~10:00 UTC; executed run ~14:30 UTC)
**Question:** if we delete the server-side query builder, do agent-written CQL queries hold up?
**Status: EXECUTED. Verdict — MIXED. Does not support proceeding to Phase 3.**

## TL;DR

Both arms ran live against production for all six cases. Results in §6.

**Agent-written queries are systematically too broad.** Two of six are unusable — 3,005 and
3,549 hits. The clearest failure is case 5: the description says "sulfide **glass ceramic**"
and the agent dropped the glass-ceramic term, which is the actual invention. It wrote
`ta="solid electrolyte" AND ta=sulfide` (3,549) where the server kept it and got 18. The
agent lost the discriminating term while following a skill whose whole purpose is to make it
keep one.

**But the server is not clean either.** Case 6 produced
`ta=drone AND ta=(turbine OR blade) AND ta=crack AND ic=F03D` — a hard OPS 404, reproducible
on re-run. Parenthesised OR inside a field is not valid CQL and appears nowhere in our
reference: the server builder invents syntax. On that case the agent's query worked and the
server's did not. This refutes F7 below, which assumed the builder never emits malformed CQL.

**Net:** the server wins on precision in 4 of 5 comparable cases, twice by two orders of
magnitude. Deleting it today would ship a measurable regression — and in a **Prior-Art
Search**, a query returning 3,549 hits instead of 18 means the closest art is never seen.

The eight guidance findings in §5 were written during the blocked run and still stand; F7 is
now known to be wrong and is annotated.

---

## 0. How this ran

The first attempt (§1) was blocked: every backend route returned `402 subscription_required`
because the trial had been cancelled 18 hours in and had elapsed. That was correct product
behaviour, not a bug. Access was restored and the gate re-run unchanged — the six queries in
§4 were written *before* any results were seen, which is what makes the comparison honest.

Result counts come from `POST /v1/patent-search` with `range: "1-1"`, which returns `total`.
Note the CLI's `patent search` surfaces neither a total nor classification codes; the raw API
passthrough was needed. Driver script: `~/.claude/jobs/2d474a43/tmp/phase2.py` — re-runnable
in about a minute.

---

## 1. The blocker, verbatim

Environment:

- Binary: `/Users/abdullahatrash/flowleap/flowleap-cli/target/release/flowleap`
  (the brief's path, `/Users/abdullahatrash/flowleap-cli/...`, does not exist — the repo is
  under `~/flowleap/`)
- Base URL: `https://api.flowleap.co` (production, as briefed)
- Auth: authenticated as `abodi1987@gmail.com`

```
$ flowleap auth status
Base URL:  https://api.flowleap.co
Auth:      Authenticated (token)
Email:     abodi1987@gmail.com
Name:      Abdullah Atrash
```

Arm C (execute my query):

```
$ flowleap --json patent search --query 'ta=perovskite AND ic=H01L' --limit 3
{
  "body": {
    "error": {
      "code": "subscription_required",
      "message": "An active FlowLeap subscription is required. Start your free trial to continue.",
      "type": "payment_required",
      "upgradeUrl": "https://flowleap.co/en/pricing"
    }
  },
  "contentType": "application/json; charset=utf-8",
  "ok": false,
  "status": 402,
  "subscriptionHint": {
    "message": "This command requires an active FlowLeap subscription (Basic plan or higher). Subscribing happens in a browser, so an agent cannot complete this alone — ask the user to subscribe at https://flowleap.co/en/pricing, then retry.",
    "plan": "Basic",
    "requiresHumanIntervention": true,
    "upgradeUrl": "https://flowleap.co/en/pricing"
  }
}
```

Arm B (server query builder) — **identical failure**:

```
$ flowleap patent build-query "Solid-state battery electrolyte made from a sulfide glass ceramic" \
    --allow-external-processing --json
notice: sending the query description to FlowLeap for processing by Anthropic or OpenAI
{
  "body": {
    "error": {
      "code": "subscription_required",
      ... (same 402 body as above)
```

The gate is universal, not route-specific. `flowleap tools list` and
`flowleap ops search --cql 'ta=perovskite'` return the same 402.

### What is *not* the problem

Provider keys are configured and **live-valid**:

```
$ flowleap keys list
Provider keys (this machine):
  epo    ✓ XuNN…•••• / secret set
  uspto  ✓ pqvk…••••

$ flowleap keys test
✓ epo    [user] EPO OPS accepted the supplied consumer key/secret.
✓ uspto  [user] USPTO ODP accepted the supplied API key.
```

So this is **not** the key-gate doctrine case. EPO OPS and USPTO both accept the stored
credentials. The block sits in front of them, at FlowLeap's own billing gate.

A dry-run confirms the request is well-formed and would carry both provider keys:

```
$ flowleap --json patent search --query 'ta=perovskite AND ta=flexible AND ic=H01L' --limit 25 --dry-run
{
  "authenticated": true,
  "body": { "query": "ta=perovskite AND ta=flexible AND ic=H01L", "range": "1-25" },
  "dryRun": true,
  "method": "POST",
  "providerKeys": { "epo": true, "uspto": true },
  "url": "https://api.flowleap.co/v1/patent-search"
}
```

Note the dry-run also establishes that **the CLI passes CQL through verbatim** — it does no
client-side validation, rewriting or term-counting. Every constraint in the reference
(`MaximumTotalTerms`, `TruncationForbidden`) is enforced upstream at EPO, so a malformed
agent query fails at the far end of a network round-trip, not locally. That is relevant to
the migration decision and is finding **F7** below.

### To unblock

Start a trial / restore the Basic subscription at https://flowleap.co/en/pricing (browser,
human-only), then re-run this document's commands. Nothing else in the setup needs changing.

### A bypass I deliberately did not take

The user's own EPO OPS consumer key/secret are on this machine and validate live, so I could
have obtained an EPO OAuth token and issued the CQL searches directly against `ops.epo.org`,
bypassing the FlowLeap backend. I did not, for two reasons:

1. It would mean digging the user's secrets out of credential storage to route around a
   billing gate — not a call I should make unilaterally on a read-only fact-finding task.
2. **It would not rescue the gate anyway.** Direct EPO access recovers arm A and arm C (my
   queries, executed) but *not* arm B — the server-side builder is an LLM call behind the
   same paywall, so its query text is unavailable at any price. A one-armed A/B cannot answer
   "are agent queries better or worse than the server builder", which is the decision the
   gate exists to make.

If the maintainers want the half-loaf, direct-EPO execution of §4's queries is a ~20-minute
job once someone approves using the stored keys that way. The subscription fix is faster and
gives the whole gate.

---

## 2. What this means for the PRD 0012 decision

**The gate is undecided.** Do not read this document as either a green or a red light on
deleting the three backend routes, three IDE tools and three CLI commands.

One thing the blocker *does* establish, and it cuts against the migration's convenience: the
server-side `build-query` route and the search route share a single entitlement gate. Any
argument of the form "agents can always fall back to the builder" is already false for an
unsubscribed user — but so is the search itself, so this is a wash rather than a point for
either side.

---

## 3. Method (as far as it got)

Per the brief, I read the Phase 1 guidance from the branch without checking it out:

```
git show feat/prd-0012-phase1-query-construction-skills:extensions/copilot/assets/skills/patent-search/SKILL.md
git show feat/prd-0012-phase1-query-construction-skills:extensions/copilot/assets/skills/patent-search/references/cql-reference.md
```

I read the reference file **before** writing any CQL, as the skill mandates ("Before writing
any CQL beyond a single `pa=` or `ti=` term, read `references/cql-reference.md`"). Every field
in every query below appears in that reference; where I could not name a field's or a code's
entry, I have said so explicitly rather than guessing silently.

Queries below are **written but unexecuted**. They are the arm-A artefact, not results.

---

## 4. The six queries, as written under the new guidance

For each: the discriminating term I chose and why, the query, and the term count against the
~10-term budget. The "lazy query" line on cases 2 and 6 is the trap the brief flagged — the
one where the category word swallows the invention.

### 4.1 Flexible photovoltaic device, perovskite absorber, polymer substrate

- **Neighbourhood (rejected):** `ta=photovoltaic`, `ta="solar cell"`, `ic=H01L` alone. Each
  names the technology area; PV is one of the most crowded areas in the corpus.
- **Discriminating term:** `perovskite`. It names a specific absorber material class, not a
  device category, and it is the whole point of the invention.
- **Second term:** `flexible` — carries the substrate angle without spending a term on
  `polymer`, which is far more common and less discriminating.

```
ta=perovskite AND ta=flexible AND ic=H01L
```

3 terms. Broader fallback if under 10 hits: `ta=perovskite AND ic=H01L`.

**Caveat I could not resolve from the reference — see F1.** `H01L` is listed as
"semiconductors", but CPC moved photovoltaic devices to the `H10F` range in the 2023
reclassification. The reference's table does not mention this, so I cannot tell whether this
query is correctly classified or silently misses recent filings.

### 4.2 Machine learning to analyse patent claims and find prior art *(trap case)*

- **Lazy query the category word produces:** `ta="machine learning" AND ic=G06N` — returns
  essentially every ML patent ever filed. The invention (patents as subject matter) has
  vanished entirely.
- **Discriminating term:** `"prior art"`. The subject matter *is* patent documents; that is
  what separates this from all other ML. This is the skill's own worked example, and applying
  it here was unambiguous — the guidance works well on this case.

```
ta="prior art" AND ta="machine learning"
```

2 terms. Alternative discriminating phrasing: `ta="patent claim"`, `ta="patent analysis"`.

**Judgement call the guidance does not settle — see F2.** The skill's "balanced" default is
"one discriminating `ta` term, one classification, one date bound", but adding `ic=G06N` here
would *lose* relevant art classified in `G06F` or `G06Q`. I dropped the classification
deliberately. The reference says a classification is never discriminating *alone*; it does
not say when to omit one entirely, and on this case omitting it is clearly right.

### 4.3 Wireless EV charging, inductive coupling, foreign-object detection

- **Neighbourhood (rejected):** `ta="wireless charging"`, `ta=inductive`. Both are the area;
  inductive coupling is the standard mechanism, shared by the whole field.
- **Discriminating term:** `"foreign object"`. Foreign-object detection is the specific,
  unusual feature — the thing this invention adds to an otherwise conventional system.

```
ta="foreign object" AND ta=charging AND ic=H02J
```

3 terms. `H02J` ("power distribution, charging") is in the reference table. `B60L` (electric
vehicle propulsion, also listed) is the alternative if EV-side filings are missed.

### 4.4 CRISPR method for editing plant genomes, drought resistance

- **Discriminating term:** the *pair* `CRISPR` + `drought`. `CRISPR` alone is no longer very
  discriminating (it is now its own crowded neighbourhood); `drought` pins the application.

```
ta=CRISPR AND ta=drought AND ic=C12N
```

3 terms. `C12N` ("biotechnology, genetic engineering") is in the reference table, and this
query is close to the reference's own worked example
(`ta=CRISPR AND ic=C12N AND pd>=2020`).

### 4.5 Solid-state battery electrolyte, sulfide glass ceramic

- **Neighbourhood (rejected):** `ta=battery`, `ic=H01M` alone.
- **Discriminating term:** `"solid electrolyte"` plus `sulfide` — the chemistry is the
  invention. `sulfide` separates this from oxide/polymer solid-state electrolytes, which are
  the competing branches.

```
ta="solid electrolyte" AND ta=sulfide AND ic=H01M
```

3 terms. `H01M` ("batteries, fuel cells") is in the reference table.

I dropped "glass ceramic" rather than spending a term on it: it is a sub-variant of the
sulfide branch, and including it risks over-narrowing on a phrase that titles and abstracts
often render differently ("glass-ceramic", "glassy", "amorphous"). **F4** below covers the
guidance gap on hyphenation.

### 4.6 Drone inspecting wind turbine blades, crack detection *(trap case)*

- **Lazy query the category word produces:** `ta=drone AND ic=B64C` — every UAV patent. The
  drone is the *vehicle*, not the invention; this is the clearest instance of the category
  word swallowing the subject matter.
- **Discriminating term:** `"wind turbine blade"` + `inspection`. The invention is blade
  inspection; the airframe is incidental.

```
ta="wind turbine blade" AND ta=inspection
```

2 terms. Variant adding classification: `ta="wind turbine" AND ta=inspection AND ic=F03D`.

**This is the case where I am least confident, and the guidance is why — see F3.** The
discriminating-term rule tells me to drop `drone`, but dropping it entirely means the query no
longer expresses "drone-based" at all and will return ground-based and rope-access blade
inspection too. The rule as written has no advice for an invention that is a *combination* of
two things, each of which is a neighbourhood on its own. Whether the rule improves this case
is precisely what execution would have shown, and did not.

---

## 5. Findings against the skill and reference file

These are the part of this gate that did complete. Ordered by how much they would cost a real
agent.

**F1 — the classification table is out of date for photovoltaics, and an agent cannot tell.**
`H01L` is listed as "semiconductors". CPC's 2023 reclassification moved photovoltaic devices
to the `H10F` range. The reference presents its table as authoritative for "common areas" with
no as-of date and no accuracy caveat, so an agent follows it straight into a possibly-wrong
code on case 4.1 with no signal that anything is off. *Action: add an as-of date to the table,
and a line that CPC reclassifies and the code should be confirmed for anything post-2023.*

**F2 — no rule for when to omit the classification entirely.** The reference says a
classification is never discriminating *alone* and the "balanced" default includes one. It
never says when to include *none*. On case 4.2 including `ic=G06N` actively loses relevant art
in `G06F`/`G06Q`. *Action: add — when the invention spans classification boundaries, drop the
class and let two `ta` terms carry it.*

**F3 — the discriminating-term rule has no guidance for combination inventions.** Cases 4.6
and 4.3 are "thing A applied to domain B", where A and B are each a neighbourhood but the
*pair* is discriminating. The rule as written ("replace the category word with the specific
subject matter") reads as *drop* the category word, which on 4.6 drops the drone and pulls in
ground-based inspection. *Action: add a combination case — when two neighbourhood terms
intersect to a narrow set, keeping both IS the discrimination.*

**F4 — nothing on hyphenation, word forms or phrase matching.** I had to guess whether
`ta="wind turbine blade"` matches "wind-turbine blade", whether `ta=charging` stems to
"charge"/"charger", and whether `ta="glass ceramic"` matches "glass-ceramic". These decisions
changed my queries (4.5, 4.6). The reference documents phrase syntax (`"double quotes"`) but
not phrase *semantics*. *Action: one line on stemming and hyphen handling in EPO OPS text
fields.*

**F5 — no guidance on how many results is "right" before you look.** The refinement table
keys off >10,000 and <10, but an agent writing a query blind has no way to predict where it
will land, and the skill does not tell it to run a cheap count first. *Action: recommend
executing broad-then-narrow with a small `--limit` as a count probe before committing.*

**F6 — the term budget is stated as "~10" and never defined.** Does `pd within "2020 2023"`
cost one term or two? Does a three-word phrase cost one or three? On case 4.6 I did not know
whether `ta="wind turbine blade"` was one term or three, which matters directly for the
`MaximumTotalTerms` error the skill predicts. *Action: state what counts as a term, with the
phrase case spelled out.*

**F7 — nothing validates CQL before it costs a network round-trip.** *(Partly WRONG — see §6: the server builder emits invalid CQL too, and 404'd on case 6. The asymmetry this finding assumed does not exist.)* The dry-run above shows
the CLI forwards CQL verbatim: no term counting, no wildcard-on-`ic` check. Both errors the
skill specifically predicts (`MaximumTotalTerms`, `TruncationForbidden`) are therefore only
discoverable from a live EPO response. Under the current server-side builder, the builder
never emits those mistakes; after the migration, the agent can. *Action: this is a real cost
of the migration and belongs in the PRD — consider a client-side lint for the two hard
constraints, which are mechanically checkable.*

**F8 — the reference cannot say whether a constraint was hit, only that it exists.** I could
not confirm that following the guidance actually *prevents* `MaximumTotalTerms` and
`TruncationForbidden`, because I never got a response. Worth noting that all six of my queries
came in at 2–3 terms against a ~10-term budget — comfortably inside it — so on this test set
the budget was never close to binding. That is weak positive evidence for the constraint
guidance and nothing more.

### Did the reference have everything I needed?

Mostly, for syntax; not for semantics. Field names, operators, wildcard rules and the hard
constraints were all there and unambiguous — I never had to guess a *field name*, which is the
thing the skill most insists on. What was missing was matching behaviour (F4), term accounting
(F6), and when to omit a classification (F2). The classification table is the one place the
reference is confidently wrong rather than merely silent (F1).

---

## 6. Comparison table

Live, production, both arms. Counts are `total` from the search API.

| # | Invention | Agent | Server | More on-point |
|---|---|---|---|---|
| 1 | Flexible perovskite PV on polymer | 416 | **50** | server |
| 2 | ML for claim analysis / prior art | 3,005 | **4** | server (agent unusable) |
| 3 | Wireless EV charging + FOD | 270 | **171** | comparable |
| 4 | CRISPR plant genome / drought | 109 | **83** | comparable |
| 5 | Sulfide glass-ceramic solid electrolyte | 3,549 | **18** | server (agent dropped the key term) |
| 6 | Drone turbine-blade crack detection | **111** | **OPS 404** | **agent** — server query malformed |

The queries, side by side:

| # | Agent | Server |
|---|---|---|
| 1 | `ta=perovskite AND ta=flexible AND ic=H01L` | `ta=perovskite AND ta=flexible AND ta=photovoltaic AND ic=H01L` |
| 2 | `ta="prior art" AND ta="machine learning"` | `… AND ta=patent* AND ic=G06N` |
| 3 | `ta="foreign object" AND ta=charging AND ic=H02J` | `ta="wireless charging" AND ta="foreign object" AND (ic=H02J OR ic=B60L)` |
| 4 | `ta=CRISPR AND ta=drought AND ic=C12N` | `ta=CRISPR AND ta=plant AND ta=drought AND ic=C12N` |
| 5 | `ta="solid electrolyte" AND ta=sulfide AND ic=H01M` | `ta="solid-state battery" AND ta=sulfide AND (ta="glass ceramic" OR ta="glass-ceramic") AND ic=H01M` |
| 6 | `ta="wind turbine blade" AND ta=inspection` | `ta=drone AND ta=(turbine OR blade) AND ta=crack AND ic=F03D` ❌ |

Pattern: the server consistently adds **one more discriminating term** than the agent does
(`photovoltaic`, `patent*`, `plant`, `glass ceramic`). That single extra term is the whole
difference between 3,549 and 18.

---

## 7. Verdict

**MIXED. Do not proceed to Phase 3.**

Deleting the server-side builder now would ship a real regression in query precision. The
PRD anticipated this branch and it is the one we are on.

**Not a reason to abandon the migration.** The failure is in the *guidance*, not in the
premise — the agent had every discriminating term available in the description and did not
use them. That is fixable in the skill, which is the cheap half of this whole change.

**Phase 1b — what to fix before re-running:**

1. **Force term extraction.** The discriminating rule is not landing. Case 5 proves it: the
   phrase was in the description and was dropped. Require the agent to list every noun phrase
   from the description first and justify each omission, rather than picking terms freely.
2. **Make the count probe mandatory, not advisory.** 3,549 should have triggered a rewrite
   before the query was accepted. Add an explicit threshold: over ~1,000 hits, add a term.
3. **Reconsider the classification advice.** Case 2 shows the server's `ic=G06N` did real
   work. The current skill discourages classification when an invention spans classes (F2);
   that may be over-corrected.
4. **Document `(ic=X OR ic=Y)`.** The server used it legitimately on case 3 and it is absent
   from our reference — while the invalid `ta=(A OR B)` form on case 6 is what 404s. Both the
   valid and the invalid shape belong in the reference.

**Then re-run** `~/.claude/jobs/2d474a43/tmp/phase2.py` unchanged. Same six cases, same
comparison, directly comparable to this table.

**Also worth filing regardless of how this lands:** the server builder emits invalid CQL
(case 6) and the CLI surfaces no result total, which made the gate harder to run than it
should have been.
