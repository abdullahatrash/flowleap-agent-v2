# Office page rules

The rules the code checks apply, with their citations. Cite these texts only.
**Rule 46 EPC is deleted.** Never cite it. The EPO drawing rules are in the
Decision of the President of 7 July 2025, OJ EPO 2025, A49, in force on
1 October 2025.

Sources: 37 CFR 1.84 and MPEP 608.02 (USPTO); OJ EPO 2025 A49 and Guidelines
for Examination Part A, Chapter IX (EPO); PCT Rule 11 and Administrative
Instructions Section 207 and Annex F (PCT).

## Sheet

| Item | Rule | Value |
|---|---|---|
| Page size | 37 CFR 1.84(f); OJ EPO 2025 A49 Art. 2(2); PCT Rule 11.5 | A4 for all offices; Letter for the USPTO only; one size per application. `figures.md` sets `pageSize`. |
| Margins | 37 CFR 1.84(g); A49 Art. 1(1); PCT Rule 11.6(c) | top 25, left 25, right 15, bottom 10 mm minimum. A4 sight: 170 x 262 mm. |
| Frame | 37 CFR 1.84(g); A49 Art. 1(1); PCT Rule 11.6(c) | no frame around the sight |
| Sheet number | 37 CFR 1.84(t); PCT AI Section 207(b)(iii), Rule 11.7; A49 Art. 2(5), GL A-IX 4.2 | US and PCT: `n/N`; EPO: a consecutive integer; centred at the top of the sight, not in the margin; larger than the numerals |
| Landscape | 37 CFR 1.84(i); A49 Art. 1(2)(h); PCT Rule 11.13(j) | US: top of the sheet on the right. EPO and PCT: top of the Figures on the left. |
| PDF | USPTO Patent Center PDF Guidelines; PCT Annex F 3.1.2 | PDF 1.4 to 1.6, fonts embedded, unencrypted, one page per sheet |

## Figures

| Item | Rule | Value |
|---|---|---|
| Labels | 37 CFR 1.84(u)(1); GL A-IX 5.2; PCT Rule 11.13(k), IP 5.141 | US `FIG. 1`; EPO and PCT `Fig. 1`; consecutive Arabic numerals; a partial view is number plus capital letter (`FIG. 1A`) |
| Single Figure | 37 CFR 1.84(u)(1); GL A-IX 5.2; PCT IP 5.141 | no number and no "FIG." |
| Label size | 37 CFR 1.84(u)(2), (t); GL A-IX 4.2, 5.2 | larger than the numerals |
| Scale text | 37 CFR 1.84(k); A49 Art. 1(2)(c); PCT Rule 11.13(d) | no "actual size" or "scale 1:2" |
| Line art | 37 CFR 1.84(l); A49 Art. 1(2)(a); PCT Rule 11.13(a) | black, uniformly thick, well-defined lines |
| Sections | 37 CFR 1.84(h)(3); A49 Art. 1(2)(b); PCT Rule 11.13(b) | oblique parallel hatching, 45° preferred, never through a numeral |

## Numerals and lead lines

| Item | Rule | Value |
|---|---|---|
| Height | 37 CFR 1.84(p)(3); A49 Art. 1(2)(g); PCT Rule 11.13(h) | 0.32 cm minimum at sheet scale |
| Style | 37 CFR 1.84(p)(1); A49 Art. 1(2)(d); PCT Rule 11.13(e) | plain; no brackets, circles or inverted commas |
| One part, one numeral | 37 CFR 1.84(p)(4); A49 Art. 1(2)(i); PCT Rule 11.13(m) | the same part always has the same numeral; a numeral never names two parts |
| Match the description | 37 CFR 1.84(p)(5); A49 Art. 1(2)(i); PCT Rule 11.13(l) | every numeral in the drawings is in the description, and every numeral of the description is in the drawings (EPO: and the claims) |
| Lead lines | 37 CFR 1.84(q); GL A-IX 7.5.1; PCT IP 5.145 | short, start beside the numeral, end on the feature, never cross; a surface numeral is underlined without a lead line |

## Text

| Office | Rule | Value |
|---|---|---|
| USPTO | 37 CFR 1.84(o); MPEP 608.02 (form paragraph 6.22); MPEP 507(C) | legends with "as few words as possible"; flowchart and block boxes need labels |
| EPO | A49 Art. 1(2)(j); GL A-IX 8 | no text matter except a few short keywords; a flow sheet may have a short sentence per method step |
| PCT | Rule 11.11 | a few short catchwords for block schematics and flow sheets |

## Claimed features

37 CFR 1.83(a): the drawings must show every feature specified in the claims.
The EPC has no such rule; the Drawing Set gate checks the same coverage for
both offices through the `[F#]` links of `figures.md`.

## What code does not judge

These stay with the attorney: enough views to show the invention, suitable
legends, proportion, the front-page Figure, no new matter. The receipt says
so; never claim them.
