---
name: claim-analysis
description: Retrieve and analyze patent claims - structure, scope, elements, and limitations
user-invocable: true
---

# Claim Analysis

Retrieve actual claim text from patent databases, then perform structured analysis.

## Step 1: Retrieve Claims (NEVER invent claim text)

### For EP/WO Patents
1. `ops_api_guide` action="endpoint" endpoint="fulltext-claims" → get curl template
2. `run_in_terminal` → execute the curl command from step 1 with the target patent number
3. Add `sleep 0.2` between multiple curl calls

### For US Patents
1. `uspto_api_guide` action="endpoint" endpoint="patent" → get curl template
2. `run_in_terminal` → fetch patent by ID (includes claims)

## Step 2: Parse Claim Structure

For each independent claim:
1. **Preamble**: What the invention IS (e.g., "A method for...", "An apparatus comprising...")
2. **Transitional phrase**: Determines scope
   - "comprising" = open-ended (broadest — allows additional elements)
   - "consisting of" = closed (only listed elements)
   - "consisting essentially of" = middle ground
3. **Body**: The limitations — each element/step that defines the invention

For dependent claims:
- Map dependency chain (Claim 3 depends on Claim 1 via Claim 2)
- Identify additional limitations added at each level

## Step 3: Element-by-Element Analysis

Create a table:

| Element # | Claim Text | Technical Feature | Scope Notes |
|-----------|-----------|-------------------|-------------|
| 1a | "A wireless charging system..." | Preamble - broad device claim | Covers any wireless charging |
| 1b | "an inductive coil arranged..." | Structural limitation | Limits to inductive, not capacitive |

## Step 3b: Visual Context (Optional)

If claim references figures or drawings:
1. `get_patent_figures` with the publication number → returns the drawing pages as inline images
2. Use the figures to understand structural/spatial claim limitations and map reference numerals to claim elements

## Step 4: Scope Assessment

- **Broadest independent claim**: Which claim covers the most ground?
- **Narrowing limitations**: What dependent claims add
- **Potential design-arounds**: Elements that could be avoided
- **Prosecution history**: Check if claims were narrowed during examination

## Output Format
Save as markdown report with:
- Full retrieved claim text (verbatim, with source citation)
- Parsed structure table
- Scope assessment
- Strengths/weaknesses summary
