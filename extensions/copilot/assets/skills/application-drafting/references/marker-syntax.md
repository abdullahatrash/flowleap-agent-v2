# Marker syntax

The validators read these markers in code. Write them exactly as shown.

## Source marker

The first line of every paragraph is a source marker, alone on its line,
with the paragraph text on the next line and no blank line between:

```markdown
<!-- src: feature:F3 -->
The housing 12 holds the battery 14 against the contact plate 16.
```

An `item:O<n>` entry may follow the sources; it is a plan reference, see
[Outline Item](#outline-item).

| Marker | Source | Use for |
|--------|--------|---------|
| `<!-- src: feature:F3 -->` | Row `F3` of `feature-list.md` | Technical content from a confirmed feature |
| `<!-- src: disclosure:§2.1 -->` | A span of the disclosure (section, page or paragraph as the disclosure numbers it) | Technical content the Feature List row summarises |
| `<!-- src: figure:FIG. 1 -->` | A figure of `figures.md` | Technical content the figure shows (parts, arrangement); the figure must be in `figures.md` |
| `<!-- src: inventor:IQ-3 -->` | The filled answer to `IQ-3` in `inventor-answers.md` | Technical content from the inventor's answer |
| `<!-- src: instruction -->` | An attorney instruction in this chat | Content the attorney dictated or asked for |
| `<!-- src: template -->` | The office template | Standard statements the office template prescribes (for example the industrial-application statement) |
| `<!-- src: model-proposed -->` | None | Transitions and boilerplate only |

A figure is a source like a disclosure span, never for a value or result
the figure does not show.

One marker can name more than one source, separated by commas:

```markdown
<!-- src: feature:F3, disclosure:§2.1 -->
```

- Headings carry no marker. Never put a marker on the line above a
  heading: it is read as an empty paragraph, and its `item:` names no text.
- A paragraph with text and no marker is reported as unmarked.
- A paragraph with technical content and only `model-proposed` is a defect:
  replace it with an Inventor Question.
- The Abstract heading contains the word "Abstract"; the claims heading
  contains the word "Claims".

## Outline Item

Name the Outline Item a paragraph realises with `item:O<n>` in its marker,
after the sources:

```markdown
<!-- src: feature:F3, disclosure:§2.1, item:O7 -->
The sealing ring 18 is made of an elastomer.
```

- `item` is a plan reference, not a source. A marker with only `item`
  entries names no source and is reported.
- A paragraph with only `item` and `model-proposed` is still a
  Model-Proposed paragraph: it carries no technical content.
- `item` names a row of `draft-outline.md`; `validate_draft` reports an
  `item` that names no row, and a Technical item that no paragraph names
  (`item-coverage`, see [outline-format.md](outline-format.md)).
- A paragraph can name more than one item when it realises both.

## Reference numerals

Write a part as its name followed by its numeral: "the housing 12". Use the
name and the numeral that `figures.md` gives the part, the same pair every
time. A step of a flowchart or a block of a block diagram is named by what it
does; write it as "step 44", "block 60", "operation 44" or "box 44".

## Inventor Questions

Where a claim element, example or embodiment has no source, leave the
technical text out and write an Inventor Question. All questions sit under
one final heading, each a blockquote paragraph numbered `IQ-1`, `IQ-2`, ...
in order:

```markdown
## Inventor Questions

> **Inventor Question IQ-1:** Claim 3 recites a sealing ring. What material
> and dimensions does the sealing ring have, and in which embodiment?
> Belongs: Detailed Description, after the paragraph on the housing 12.
```

Each question names the claim element, Feature List row or figure it
concerns, and asks for the missing fact. Its last line, `Belongs:`, names
the place in the draft where the answer goes; the save copies it to
`inventor-answers.md`. It proposes no answer.

- `inventor:IQ-n` is valid only when `inventor-answers.md` has a filled
  answer to `IQ-n`; the validator reports it otherwise.
- Keep the number of a question when you narrow it after a partial answer.
