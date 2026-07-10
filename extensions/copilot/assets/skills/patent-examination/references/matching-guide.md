# Claim–Prior Art Matching Reference

## Scoring Calibration

- **0.85 - 1.0**: Clear X document. All features directly disclosed.
- **0.65 - 0.84**: Strong Y or borderline X. Most features, missing one may be implicit/obvious.
- **0.45 - 0.64**: Moderate Y. Significant overlap but clear gaps.
- **0.25 - 0.44**: Weak Y or strong A. Some relevant features, different approach.
- **0.0 - 0.24**: A document or not relevant. General background only.

## Patent Language Equivalences

| Claim Language | Meaning for Matching |
|---|---|
| "comprising" | Open-ended — additional features allowed |
| "consisting of" | Closed — only these features |
| "means for [function]" | NARROW: only the structure disclosed in the specification for that function, plus equivalents (35 U.S.C. 112(f), MPEP 2181) — do not read as any structure performing the function |
| "configured to" | Actually designed/programmed/set up to perform the function — narrower than merely "capable of" |
| "a" / "an" | One or more (not limited to single) |
| "substantially" | Approximately, within normal tolerances |

## Semantic Matching Patterns

### Strong X Indicators
- Equivalent technical terms (e.g., "turbo code" = "parallel concatenated convolutional code")
- Specific embodiment falls within claim scope
- All method steps have one-to-one correspondence
- Prior art is more specific than claim (specific anticipates generic)
- Single document + common general knowledge renders the claim obvious with no second document needed (X also covers single-reference inventive step, not only novelty)

### Strong Y Indicators
- Most but not all features disclosed
- Missing feature is well-known or obvious to substitute
- Two documents from same field complement each other
- Combination involves no contradictory teachings

### Strong A Indicators
- Same field but different problem being solved
- Key distinguishing feature is absent and not obvious
- Fundamentally different approach to similar results

## Multi-Passage Analysis

1. Score each passage independently
2. Check for X documents first (single reference novelty kill)
3. If no X, check if Y combinations cover all features
4. Rank by relevance score, highest first
5. For Y combinations, state which features each document contributes

## Output Formats

### Quick Assessment
```
Relevance: X document (score: 0.91)
The passage directly discloses all essential features of claim 1.
Key match: [brief explanation]
```

### Batch Comparison Table
| # | Source | Category | Score | Features Matched | Missing |
|---|--------|----------|-------|-----------------|---------|
| 1 | EP1234 ¶42 | X | 0.92 | F1-F5 all | — |
| 2 | US5678 ¶15 | Y | 0.71 | F1,F2,F5 | F3,F4 |
| 3 | WO9012 abs | A | 0.18 | F1 only | F2-F5 |
