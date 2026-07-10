---
name: claim-analysis
description: Retrieve and dissect patent claims — preamble/transitional-phrase/body structure, dependency chains, element tables, and scope assessment. Use when the user asks what a patent's claims cover, wants claim structure parsed, scope or breadth assessed, or design-around candidates identified. For scoring claims against prior art use patent-examination; for comparing the user's OWN claim to existing patents use the compare_claims tool; to draft new claims use claim-drafting.
user-invocable: true
---

# Claim Analysis

Retrieve actual claim text from patent databases, then perform structured analysis.

## Step 1: Retrieve Claims (NEVER invent claim text)

- **EP/WO patents**: `get_patent_details` with the publication number — returns biblio plus full claims and description where published
- **US patents**: `uspto_api_guide` action="endpoint" endpoint="grants" → execute with `patent_api_request` to look up the granted patent by number (response includes claims)
- **User's own claim vs existing patents**: `analyze_claim` to decompose the user's claim, then `compare_claims` against specific patent numbers — it fetches the real claims and maps overlaps/differences

## Step 2: Parse Claim Structure

For each independent claim:
1. **Preamble**: what the invention IS (e.g., "A method for...", "An apparatus comprising...")
2. **Transitional phrase**: determines scope
   - "comprising" = open-ended (broadest — allows additional elements)
   - "consisting of" = closed (only listed elements)
   - "consisting essentially of" = middle ground
3. **Body**: the limitations — each element/step that defines the invention

For dependent claims:
- Map the dependency chain (Claim 3 depends on Claim 1 via Claim 2)
- Identify additional limitations added at each level

## Step 3: Element-by-Element Analysis

| Element # | Claim Text | Technical Feature | Scope Notes |
|-----------|-----------|-------------------|-------------|
| 1a | "A wireless charging system..." | Preamble - broad device claim | Covers any wireless charging |
| 1b | "an inductive coil arranged..." | Structural limitation | Limits to inductive, not capacitive |

### Visual Context (Optional)
If the claim references figures: `get_patent_figures` with the publication number → drawing pages as inline images. Use them to understand structural/spatial limitations and map reference numerals to claim elements.

## Step 4: Scope Assessment

- **Broadest independent claim**: which claim covers the most ground?
- **Narrowing limitations**: what dependent claims add
- **Potential design-arounds**: elements that could be avoided
- **Prosecution history**: check if claims were narrowed during examination (`ops_api_guide` endpoint="register-events" → `patent_api_request` for EP patents)

## Output
Save via `write_patent_results`:
- Full retrieved claim text (verbatim, with source citation)
- Parsed structure table
- Scope assessment
- Strengths/weaknesses summary
