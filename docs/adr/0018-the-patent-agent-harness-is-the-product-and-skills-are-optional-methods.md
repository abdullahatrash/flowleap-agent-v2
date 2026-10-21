# The Patent Agent harness is the product, and skills are optional methods the attorney can change

**Status:** proposed (2026-10-20)

The Patent Agent reached its quality with three layers that grew together: a long system prompt
that routes, 44 typed tools whose descriptions carry data knowledge, and 34 bundled skills that
carry method, doctrine and more data knowledge. Measured on main on 2026-10-20: the prompt is
10,168 words; the tool text is 13,126 words (8,199 of description, 4,927 of schema), of which one
tool, the results writer, is 3,504; five guide and raw-route tools add 722; the eight heaviest
skills are 1,100 to 3,400 words each. Every attorney turn pays the prompt and the tools; a skill
is paid when it loads. An attorney cannot change a bundled skill and keep the change across an
update, because the built-in copy wins (#743). Three findings this week set the direction: a
reference tool is called eagerly, whatever its description says (harness step 1); knowledge that
rides the owning tool's schema and result text holds quality with a shorter skill (49/51 → 51/51
with `patent-search` as method only); and a scraped copy of public text drifts, so the office's
own page is the source (ADR 0017). The founder's direction: "the skills should be optional like
any harness, the harness should be good enough." This ADR is the one page every harness PR
points at.

## The decisions

1. **The harness alone meets the quality gate.** Every deliverable the gates measure (search,
   prior art, dossier, invalidity chart, office-action response, drafting, drawings) must pass
   with no skill loaded. A skill may make a run faster or shape a report; it may not be the only
   place a rule lives. The skill-grounded suite runs with the skill removed from the bundle as
   the proof. Rejected: skills as the carrier of doctrine (a skill the attorney edits can delete
   a rule the product needs).
2. **Data knowledge lives with its owner, in three places and no fourth.** Before the call, in
   the tool's input schema (field list, grouping, wildcard rule). After the call, in the result
   text (`Next step` line, fault fix, validation finding). On demand, in the backend (one
   grammar per search provider through `get_search_syntax`, one docs catalog for humans). Public
   law lives on the office's page (ADR 0017). Rejected: separate guide tools (`*_api_guide`) and
   the raw `patent_api_request` in the default set; measured, the model reads a guide before
   every call it describes.
3. **One typed tool per job, with a provider parameter, not one tool per office.** `search_patents`
   takes `provider` (`epo_ops` or `uspto`) and its schema carries both grammars' field lists;
   the US path is one hop, not three. The same shape applies to any tool that today has an EPO
   and a USPTO twin behind a guide. Rejected: a tool per office (doubles the surface) and a
   single "smart" search that hides the office (the attorney must know which index answered).
4. **The default tool set is the smallest set that passes the gates.** Target for the Patent
   Agent prompt: at most 30 tools and 8,000 words of tool text, and a system prompt under 6,000
   words, reached by removal PRs that each hold the gates and cut tokens per task. The results
   writer's description carries its contract only; per-template rules move to its validation
   result, which already names the fix. Tools outside the default set stay registered and
   reachable by name. Rejected: a fixed cut list decided now (each removal is measured, and the
   gates decide).
5. **Skills are methods, seeded into the attorney's own folder, and the attorney's copy wins.**
   A skill is ordered steps with a "Done when" each, no tool names, no API detail, about five
   steps with reference files. On first run the bundle is copied to the user skills folder; the
   loader prefers the user's copy over the built-in one; an update refreshes a copy the attorney
   has not changed and leaves a changed one alone, with the diff shown. Rejected: a skills
   repository the app pulls at run time (a second distribution channel to keep in sync, for a
   problem a folder solves).
6. **The backend keeps one grammar per provider and no copy of public text.** `SEARCH_SYNTAX`
   per provider is the single source the tools' schemas and result text are written from; the
   docs catalog describes tools for humans and agents and carries no doctrine; the legal RAG is
   retired (ADR 0017). The CLI pack and the hosted MCP catalog follow the same owner rule, so the
   three surfaces converge instead of each carrying its own copy. Backend changes stay additive
   and versioned until the app release that uses them is out.
7. **Every step is one PR behind the full bar, and the measure is quality held and tokens cut.**
   Each PR names the decision above it delivers and reports: main suite, trajectory repeat gate,
   key-gate repeat, skill-grounded with the skill removed, tokens per task for the affected
   deliverable, and the laptop run. Rejected: one rewrite branch (no staging; one long branch
   drifts from main and lands as one unreviewable merge).

## Consequences

- The system prompt loses routing lines as tools carry their own routing; branches that only
  repeat a tool's description go first.
- The 34 skills are classified sentence by sentence as method, data knowledge or doctrine. Data
  knowledge moves to the owning tool; doctrine that a gate measures moves to tool result text or
  the prompt; the method stays, shorter. Heavy skills (prior-art, invalidity-analysis,
  application-drafting, find-better, patent-landscape, office-action-response, freedom-to-operate)
  go one per PR.
- The key-gate doctrine (ADR 0005 and issues #173 to #176) is harness, not skill: its regressions
  are fixed in the prompt and tool result text and measured by the key-gate repeat gate.
- The eval harness is part of the product: it caches the shared prefix (#832), its judge is
  pinned and measured (#834), and every step records tokens per task next to pass counts.
- Attorneys get a visible skills folder they own; the Prompts page and the skills install
  refresh (#150) point at it.

## The map

| Surface item | Today (2026-10-20) | Target | Step |
|---|---|---|---|
| `patent-search` skill, search tool, CQL grammar | app #779 + backend #598, drafts, gates green | merged after the laptop run | harness search 1 |
| US search path | `uspto_api_guide` → `patent_api_request`, 3 hops | `search_patents provider=uspto`, ODP fields in schema; guide and raw route leave the default set | harness search 2 |
| Legal tools and RAG | app #830 merged; CLI #159 draft; backend still answers | CLI tag → plugins #32, app #833 → backend 410 → delete with dump | ADR 0017 steps 2 to 4 |
| `ops_api_guide`, `citation_api_guide`, `patstat_api_guide` | 452 words of guide text in the default set | field lists in the owning tool's schema, fault fix in result text; raw route non-default | one PR each |
| `write_patent_results` | 3,504 words of description | contract only; per-template rules in the validation result | one PR |
| Key-gate K1, K3b | regress on main after #830 (live-office completion, web fallback) | pass in the key-gate repeat gate, fixed in prompt and result text | next harness PR |
| Skills loader | built-in copy wins (#743), edits lost on update | seeded user folder wins; untouched copies refreshed | one PR, after the heavy-skill migrations start |
| 34 skills | method + data + doctrine mixed, 1,100 to 3,400 words | method only, about five steps each, references for detail | one PR per heavy skill |
| System prompt | 10,168 words | under 6,000 | shrinks with each tool PR |
| Backend grammars and docs | `SEARCH_SYNTAX` epo_ops done (#598); uspto next | one grammar per provider, docs catalog for humans | with harness search 2 |
| Dev database | Supabase production pooler on the laptop | plain Postgres + seed user in Docker | after ADR 0017 step 4 |
