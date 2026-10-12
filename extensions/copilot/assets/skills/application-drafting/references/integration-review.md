# Integration review

The items were drafted one by one. Read the whole draft once, against the
Draft Outline, the Feature List and `figures.md`, before the save in Step 4.
The review is advice: it adds no technical content and never answers an
Inventor Question.

## Correct or report

Correct in the draft only what the matter files decide: a word the
disclosure uses, a numeral `figures.md` gives, a sentence written twice. A
correction keeps the paragraph's marker. Report everything else as an
integration item. Make the corrections first, then write the items, so that
each line is the line of the draft you save.

## Checklist

| Check | Look for | The matter files decide when |
|-------|----------|------------------------------|
| Terminology | One thing with two words, or one word for two things, across sections. Use the disclosure's word, one word per thing. | The Feature List or the disclosure uses one word. |
| Figures and numerals | A part with a numeral other than its `figures.md` numeral; a figure the text names that `figures.md` does not have; a figure in `figures.md` that no paragraph walks through. | `figures.md` gives the name and the numeral. |
| Contradictory embodiments | Two passages that state different values, materials or arrangements for the same embodiment; an alternative described as required in one place and optional in another. | Never: report it, the inventor or the attorney decides. |
| Duplicated passages | The same sentence or the same explanation in two items (the `duplicate-sentence` Note of `validate_draft` finds exact repeats). | The sentence belongs to one item: keep it there. |
| Claimed combinations | For each item that lists more than one claim (`1, 3`): text that states the features of the claims together, in one embodiment. Each term appearing somewhere is not support for the combination. | Never: quote the support, or report that no passage combines the features. |
| Planned items | Each Technical item realised by a paragraph with its `item:O<n>`, or by an Inventor Question (`item-coverage`). | The outline row decides: write the paragraph from its sources. |
| Scope and clarity | Words that narrow a claim the disclosure does not narrow ("essential", "must", "critical", "the invention is"); relative terms without a reference point. | The disclosure uses the word: keep it. |

## Integration items

Write one integration item per point. Each item:

1. Quotes the passage, word for word.
2. Gives its line in `draft-application.md`.
3. States what is wrong, in one sentence.
4. States what to do: the correction, the Inventor Question to ask, or the
   decision the attorney makes.

Write one item for each claimed combination the outline planned. It quotes
the passage that states the features together, or states that no passage
does and names the Inventor Question that asks for it.

```text
Line 48: "The sealing ring 18 is made of an elastomer and seats in the
groove 20 of the piston 14." Claims 1 and 2: this passage states the
elastomer sealing ring together with the piston and the housing 12 of claim 1.
```

```text
Line 61: "the seal 18". The disclosure and claim 1 say "sealing ring".
Write "the sealing ring 18".
```

Pass the items to `validate_draft` as advisory items in Step 4. They are
recorded as Advisory findings and never block export.

## What the review never says

The review never says "passed", "complete", "ready to file" or "no issues".
When a check finds nothing, write nothing for it. A quoted support passage
is a statement of where the support is, not a verdict.
