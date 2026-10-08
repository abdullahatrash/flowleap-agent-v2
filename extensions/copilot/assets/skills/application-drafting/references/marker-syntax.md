# Marker syntax

The validators read these markers in code. Write them exactly as shown.

## Source marker

The first line of every paragraph is a source marker, alone on its line,
with the paragraph text on the next line and no blank line between:

```markdown
<!-- src: feature:F3 -->
The housing 12 holds the battery 14 against the contact plate 16.
```

| Marker | Source | Use for |
|--------|--------|---------|
| `<!-- src: feature:F3 -->` | Row `F3` of `feature-list.md` | Technical content from a confirmed feature |
| `<!-- src: disclosure:§2.1 -->` | A span of the disclosure (section, page or paragraph as the disclosure numbers it) | Technical content the Feature List row summarises |
| `<!-- src: instruction -->` | An attorney instruction in this chat | Content the attorney dictated or asked for |
| `<!-- src: template -->` | The office template | Standard statements the office template prescribes (for example the industrial-application statement) |
| `<!-- src: model-proposed -->` | None | Transitions and boilerplate only |

One marker can name more than one source, separated by commas:

```markdown
<!-- src: feature:F3, disclosure:§2.1 -->
```

- Headings carry no marker.
- A paragraph with text and no marker is reported as unmarked.
- A paragraph with technical content and only `model-proposed` is a defect:
  replace it with an Inventor Question.
- The Abstract heading contains the word "Abstract"; the claims heading
  contains the word "Claims".

## Reference numerals

Write a part as its name followed by its numeral: "the housing 12". Use the
name and the numeral that `figures.md` gives the part, the same pair every
time.

## Inventor Questions

Where a claim element, example or embodiment has no source, leave the
technical text out and write an Inventor Question. All questions sit under
one final heading, each a blockquote paragraph numbered `IQ-1`, `IQ-2`, ...
in order:

```markdown
## Inventor Questions

> **Inventor Question IQ-1:** Claim 3 recites a sealing ring (Detailed
> Description, after the paragraph on the housing 12). What material and
> dimensions does the sealing ring have, and in which embodiment?
```

Each question names the claim element, Feature List row or figure it
concerns, and the place in the draft where the answer belongs, and asks for
the missing fact. It proposes no answer.
