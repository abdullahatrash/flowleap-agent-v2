---
name: claim-drafting
description: Draft patent claims from an invention disclosure and prior art search results — independent claims aimed at the established novelty gap, dependent fallback ladders, US and EPO two-part styles, support checks, and a mandatory self-examination loop against the found prior art. Use when the user asks to draft, write, or propose claims for their invention ("draft claims", "write claim 1 for this"). For dissecting existing claims use claim-analysis; output is always a draft for patent attorney review.
user-invocable: true
---

# Claim Drafting

Draft claims FROM search results, not from imagination. A claim drafted blind to the prior art dies in examination.

## Prerequisite: the Novelty Gap

You need prior art search results and a **novelty gap statement** — which feature or combination no reference teaches. If none exists yet, run the **prior-art** skill first (or the **invention-disclosure** skill for a full IDF). If the user insists on drafting without a search, do it, but label the claims "not searched — scope unvalidated".

## Step 1: Independent Claim Construction

- **Category**: pick per statutory class — method, apparatus/system, and (for software) computer-readable medium. Draft one independent claim per category that makes commercial sense.
- **Preamble**: what the invention IS, kept broad ("A method for charging a battery...").
- **Transitional phrase**: "comprising" (open-ended) unless there is a specific reason to close it.
- **Body**: the MINIMUM set of elements that (a) makes the claim novel over every found reference — the novelty gap features go here — and (b) is essential for the invention to work. Every additional element narrows scope and is a gift to infringers: for each element ask "does the claim survive examination without this?" If yes, move it to a dependent claim.

## Step 2: Dependent Claim Ladder (fallback strategy)

Each dependent claim is a retreat position for when closer art surfaces:
- Add ONE meaningful limitation each, drawn from the embodiments/variations in the disclosure
- Order by defensive value: first the features the closest references almost-but-not-quite teach, then preferred embodiments, then commercially important variants
- No trivial dependents ("wherein the housing is blue") — each must be independently arguable as inventive
- Typical draft: 3-6 dependents per independent claim

## Step 3: Jurisdiction Style

- **US**: plain comprising-style claims as above
- **EPO**: two-part form — preamble contains the features shared with the closest prior art (D1), then "characterized in that" introduces the distinguishing features. Identify D1 explicitly from the search results.
- If jurisdictions are undecided, draft the US-style set and show claim 1 additionally in EPO two-part form.

## Step 4: Support & Formalities Check (112 / EPC Art. 84)

Run every claim through this checklist:
- **Support**: every claim term traces to the disclosure. If a needed element has NO support, do not invent it — flag it as a **specification gap** for the attorney/inventor to fix
- **Terminology**: same word = same thing, and it's the disclosure's word, not a synonym you introduced
- **Antecedent basis**: "a processor" before any "the processor"
- **Means-plus-function**: avoid "means for [function]" unless deliberately invoking 112(f); prefer structural terms
- **Relative terms**: "substantially", "about" only where the disclosure gives a standard or range
- Ground doubtful calls with `search_legal` (e.g. query="written description requirement functional claim", jurisdiction="USPTO")

## Step 5: Self-Examination Loop (MANDATORY)

Play examiner against your own draft using the **patent-examination** skill:
1. Decompose draft claim 1 into features; map each of the top 3-5 search references against it
2. Any reference rates **X** (all features taught) → the claim is dead as drafted: promote a distinguishing feature from the dependents (or the disclosure) into claim 1 and repeat
3. Target end state: closest reference rates **Y at most**, and you can articulate why the skilled person would NOT combine (or what technical effect the combination misses)
4. Record the final mapping — it is the argument skeleton for prosecution

## Output

Save via `write_patent_results`:
1. **Claim set** — numbered, independent + dependents, per jurisdiction style
2. **Support table** — each claim element → where the disclosure supports it (and any flagged spec gaps)
3. **Design rationale** — why each element is in claim 1; what each dependent defends against
4. **Self-examination result** — final feature mapping vs the top references, with the non-obviousness rationale

## Rules
- NEVER present output as filing-ready: every deliverable states "Draft claims for review by a registered patent attorney — not legal advice"
- NEVER invent support — a claim element without disclosure basis is a spec gap, not a drafting liberty
- ALWAYS run the self-examination loop before delivering; a claim set without the Step 5 mapping is incomplete
- Keep the inventors' terminology; introduce new terms only with a definition
