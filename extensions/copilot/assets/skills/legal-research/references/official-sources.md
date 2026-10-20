# Official sources of patent law

The URL pattern of each office, with one worked example each. Each pattern was verified by
fetch on 2026-10-20: one plain HTTPS GET, no browser identity, and a check that a known phrase
of the section is in the returned text. "Verified by fetch" below means that check passed. A
status of 200 alone proves nothing: two hosts answer 200 with a placeholder or a bot-check
page, and each one is named below. A pattern can change: when a fetch does not return the
section, fetch the index page of the source and find the section from its titles.

## USPTO: MPEP (office guidance)

- Section page: `https://www.uspto.gov/web/offices/pac/mpep/s<NNNN>.html`, where NNNN is the
  four-digit section number. A sub-section (2143.01) is a heading inside its parent page
  (s2143.html). There is no page per sub-section: s2143.01.html does not exist.
- Chapter index: `https://www.uspto.gov/web/offices/pac/mpep/mpep-<NNNN>.html` (mpep-2100.html).
  Full index: `https://www.uspto.gov/web/offices/pac/mpep/index.html`.
- Edition: each section heading ends with the revision marker, for example `[R-01.2024]`. Quote
  it as the edition.
- Example: MPEP 2143 → https://www.uspto.gov/web/offices/pac/mpep/s2143.html. Verified by
  fetch 2026-10-20 (section page and chapter index).

## USPTO: 35 USC (statute)

- Official, fetchable: the GPO link service
  `https://www.govinfo.gov/link/uscode/35/<N>?link-type=html`, where N is the section number.
  It redirects to the section page of the latest main edition of the United States Code
  (govinfo.gov is the Government Publishing Office). Without `link-type=html` it returns a PDF.
- Edition: the page header says "United States Code, 2024 Edition" (text seen 2026-10-20). The
  main edition is annual and the supplements lag: say so when the question turns on a recent
  amendment, and read the MPEP section for the text the office applies.
- Not fetchable on 2026-10-20: the Office of the Law Revision Counsel site
  `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title35-section<N>&num=0&edition=prelim`
  answered 200 with a "Page Not Found" body and the notice "the website is currently operating
  in a temporary format". Do not cite a page you could not read.
- Mirror, not the office: `https://www.law.cornell.edu/uscode/text/35/<N>` (Cornell LII). Use it
  only when govinfo does not answer, and say so.
- Example: 35 USC 103 → https://www.govinfo.gov/link/uscode/35/103?link-type=html. Verified by
  fetch 2026-10-20 (also 35 USC 112).

## USPTO: 37 CFR (rules)

- Official, fetchable: the eCFR renderer API
  `https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-37?section=<part>.<section>`.
  It returns the section as HTML with the heading "§ 1.362 Time for payment of maintenance
  fees." and the paragraphs. The API body shows no "up to date as of" line.
- Bot-checked, not fetchable by a non-browser: the human page
  `https://www.ecfr.gov/current/title-37/section-<part>.<section>` answered 200 with a
  "Request Access" CAPTCHA page on 2026-10-20 ("programmatic access to these sites is limited to
  our developer APIs"). Cite the human page URL for the reader; fetch the API URL.
- Edition: the human page header says "Displaying title 37, up to date as of 10/16/2026" (text
  seen 2026-10-20 in a browser). From the API, give the fetch date and say "eCFR current text".
- Mirror, not the office: `https://www.law.cornell.edu/cfr/text/37/<part>.<section>`.
- Example: 37 CFR 1.362 →
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-37?section=1.362 (fetch);
  https://www.ecfr.gov/current/title-37/section-1.362 (cite). Verified by fetch 2026-10-20 (API
  and mirror).

## EPO: EPC articles and Implementing Regulations

- Article: `https://www.epo.org/en/legal/epc/2020/a<N>.html`. Rule:
  `https://www.epo.org/en/legal/epc/2020/r<N>.html`. Index:
  `https://www.epo.org/en/legal/epc/2020/index.html`. A paragraph (Art. 123(2)) is a part of
  its article page. The table of contents of the index page sits in a script block, so a text
  fetch of the index may not show it: build the article URL from the number instead.
- Edition: the article page shows no edition text. Give the URL, which names the EPC 2020
  text, and the date of the fetch.
- Example: EPC Art. 54 → https://www.epo.org/en/legal/epc/2020/a54.html. Verified by fetch
  2026-10-20 (also Rule 6).

## EPO: Guidelines for Examination

- Section page: `https://www.epo.org/en/legal/guidelines-epc/<YEAR>/<part>_<chapter>_<section>.html`,
  in lower case, with the chapter in Roman numerals: g_vii_5.html, g_vii_5_2.html, h_v_3_1.html,
  c_iv_5.html.
- Edition: the index `https://www.epo.org/en/legal/guidelines-epc` names the edition in force.
  On 2026-10-20 it said: "2026 edition entered into force on 1 April 2026, superseding the 2025
  edition". The previous year's path is still served (2025/g_vii_5.html returned the old text),
  so a wrong year returns an old text with no error. Read the year from the index page, never
  from memory.
- PCT-EPO Guidelines: `https://www.epo.org/en/legal/guidelines-pct/<YEAR>/index.html`.
- Example: Guidelines G-VII, 5 → https://www.epo.org/en/legal/guidelines-epc/2026/g_vii_5.html.
  Verified by fetch 2026-10-20 (section, index, PCT-EPO index).

## EPO: case law

- Case Law of the Boards of Appeal (the book):
  `https://www.epo.org/en/legal/case-law/<YEAR>/clr_<part>_<chapter>_<section>_<sub>.html`.
  Index: `https://www.epo.org/en/legal/case-law`. On 2026-10-20 the index named the "11th
  edition / 2026 revision" with decisions up to 31 December 2025, and linked
  case-law/2025/index.html. Read the year from the index page.
- Board decision: `https://www.epo.org/en/boards-of-appeal/decisions/<t|g>YYNNNNex1`, where YY
  is the two-digit year of the case number and NNNN the zero-padded number. G 1/19 →
  g190001ex1. T 641/00 → t000641ex1. T 1173/97 → t971173ex1. The suffix eu1 does not exist.
- Example: Case Law book I.C.4.1 → https://www.epo.org/en/legal/case-law/2025/clr_i_c_4_1.html.
  Verified by fetch 2026-10-20 (book section, index, G 1/19, T 641/00).

## WIPO: PCT articles and Regulations

- Rule: `https://www.wipo.int/en/web/pct-system/texts/rules/r<N>`. Article:
  `https://www.wipo.int/en/web/pct-system/texts/articles/a<N>`. Index:
  `https://www.wipo.int/en/web/pct-system/texts/index`. A paragraph (Rule 4.9) is a part of
  its rule page. The old paths (https://www.wipo.int/pct/en/texts/rules/r4.html) redirect to
  the new ones.
- Edition: the index page says "Regulations under the PCT (as in force from January 1, 2026)"
  (text seen 2026-10-20). The rule page itself shows no edition text: take it from the index.
- Example: PCT Rule 4 → https://www.wipo.int/en/web/pct-system/texts/rules/r4. Verified by
  fetch 2026-10-20 (rule, old path, Art. 3, index).

## WIPO: PCT Applicant's Guide

- Index: `https://www.wipo.int/en/web/pct-system/guide/index`. International phase:
  `.../guide/ipindex`. National phase: `.../guide/npindex`.
- Office chapter: `https://pctlegal.wipo.int/eGuide/view-doc.xhtml?doc-code=<CC>&doc-lang=en`,
  where CC is the two-letter office code. The page is large (about 520 KB for EP).
- Edition: the page header says "Valid as from September 17, 2026" and "Last updated on
  October 14, 2026" (EP chapter, text seen 2026-10-20). Quote both.
- Example: EPO chapter → https://pctlegal.wipo.int/eGuide/view-doc.xhtml?doc-code=EP&doc-lang=en.
  Verified by fetch 2026-10-20 (EP and US chapters, index, national-phase index).

## US case law

The USPTO has no case-law page. Read the MPEP section that applies first: it names the
decisions and quotes their holdings. For the opinion itself:

- Federal Circuit: https://www.cafc.uscourts.gov/home/case-information/opinions-orders/.
- Supreme Court: https://www.supremecourt.gov/opinions/opinions.aspx.

These are search pages, not section pages (both verified by fetch 2026-10-20). Name the case
and the year, and say when you could not open the opinion.

## Section map for common questions

Use the map to pick the section in step 2. Then fetch the page: the map is a pointer, not a
source.

| Question | US | EP |
|---|---|---|
| Patentable subject matter | 35 USC 101; MPEP 2106 (analysis), 2106.04 (abstract ideas) | EPC Art. 52(2)(c); Guidelines G-II, 3 |
| Novelty | 35 USC 102; MPEP 2131 (anticipation), 2152 (AIA prior art) | EPC Art. 54; Guidelines G-VI |
| Obviousness, inventive step | 35 USC 103; MPEP 2141 to 2145 | EPC Art. 56; Guidelines G-VII, 5 (problem-solution) |
| Written description, enablement, clarity | 35 USC 112; MPEP 2161 to 2164 | EPC Art. 83, 84; Guidelines F-III, F-IV |
| Added subject-matter | 35 USC 132; MPEP 2163.06 | EPC Art. 123(2); Guidelines H-V |
| Claim interpretation | MPEP 2111 (broadest reasonable interpretation) | Guidelines F-IV, 4 |
| Grace period, own disclosure | 35 USC 102(b)(1); MPEP 2153 | EPC Art. 55 (six months, limited cases) |
| Opposition, review | MPEP Chapter 2200 (reexamination); 35 USC 311 to 319 (IPR), 321 to 329 (PGR) | EPC Art. 99 to 105; Guidelines D |
| Maintenance, renewal fees | 37 CFR 1.362; MPEP Chapter 2500 | EPC Art. 86; Rule 51 |
| PCT routing | PCT Art. 22, 39; Rule 4; Applicant's Guide US chapter | EPC Art. 153; Guidelines E-IX; Applicant's Guide EP chapter |

Two traps the map must not hide:

- MPEP 2132 is the pre-AIA novelty section. For a first-inventor-to-file application, read
  MPEP 2152, not 2132.
- MPEP 2111 (broadest reasonable interpretation) applies to a pending application under
  examination. A granted patent in litigation or in an IPR is read under the Phillips
  ordinary-meaning standard, which is case law, not the MPEP.
