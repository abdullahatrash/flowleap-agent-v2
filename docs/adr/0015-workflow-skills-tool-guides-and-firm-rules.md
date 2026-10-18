# Patent Skills split into Workflow Skills and Tool Guides; firms customize with Firm Rules, never by override

**Status:** parked (2026-10-18), not accepted. Proposed 2026-10-16.

> Parked by the founder on 2026-10-18. The PRD (#675) and its tickets (#676–#688) are closed as
> not planned. The proposal grew from the question "do user edits to a built-in skill survive an
> update?", not from an attorney request. In FlowLeap a Patent Skill is the vehicle for
> FlowLeap's own knowledge of the data, not a user customization surface. The open question is
> where that data knowledge lives: skill text, tool description and result, or the backend
> facade. The measured content shares below stay valid as input to that rethink. The side
> findings #689–#692 stay open.

Attorneys want to adapt the Patent Skills to their firm (house style, report sections, claim
format). Today they can open a Patent Skill's `SKILL.md` in the app install folder and save it,
and the next app update deletes the change without a warning (every platform replaces the whole
install folder; on macOS the edit also breaks the code-signing seal). A copy does not help: a
user skill with the same name does not load (#577), and a copy with a new name competes with the
shipped skill for routing.

The root cause is that one file holds three kinds of content with different owners. Measured
over the 34 Patent Skills (2026-10-15): the tool chain (tool names, call order, query syntax)
is 50–80% of the search skills; legal doctrine is 70–88% of the UPC and fee skills; the output
form that a firm wants to change is only 10–45% of any skill. A firm copy freezes the tool chain
(the frozen CLI skill copies of #150 taught a removed flag) and can delete doctrine that exists
only in the skill text.

## The decisions

1. **A Patent Skill is split into a Workflow Skill and Tool Guides.** The **Workflow Skill**
   holds the method, the output form and the doctrine that needs judgment, and names no tool,
   command or query syntax. A **Tool Guide** holds how to get one family of data in one harness
   (for example CQL and the classification-only track for patent search). The target is one set
   of Workflow Skills for every harness (editor chat, Agents window, CLI); each harness supplies
   its own Tool Guides. The editor chat goes first; the CLI `recipe-*` skills merge in later.
   Rejected: keeping the tool chain in the skill (every backend change touches many skills, and
   the editor and CLI keep two drifting skill sets).
2. **Patent Skills stay read-only and are never overridden.** The update replaces them, and no
   user skill can shadow one (#577 decision 5 stands). Every path that can write a Patent Skill
   (the "Configure Skills..." editor, the "Open" action, the agent's edit tools) is closed, and
   points the user to Firm Rules.
   Rejected: a full override (VS Code "Save override", Claude Code, Harvey "duplicate"): it
   freezes the tool chain and can drop doctrine. Rejected: override with stale detection and a
   3-way merge (Debian conffiles, WooCommerce): attorneys will not merge legal workflow text.
3. **Firms customize with Firm Rules.** Firm Rules add to a Workflow Skill and survive every
   update. They live per workspace (`.flowleap/instructions/`) or per person
   (`~/.flowleap/instructions/`), and a rule can name the Workflow Skills it is for. Order of
   precedence: code > Workflow Skill doctrine > Firm Rules > Workflow Skill output form. When
   the agent does not apply a Firm Rule because of the doctrine, it says so. This records #577
   decision 6, which had no ADR, and extends it with skill targeting and the order.
   Rejected: free-text rules with no targeting (a drafting rule then applies to every chat, or
   the model guesses); Firm Rules that win over the doctrine (a firm could make the agent say
   "ready to file"). Note the limit of decision 4: on a tool-written surface that promise is
   code-backed; in a chat answer it rests on the Doctrine section and the precedence line the
   package carries, checked by an eval case, not on code.
4. **Doctrine that a machine can check moves into code where a tool writes the output.** Exact
   phrases and numbers (no dollar amounts, "declared" never "essential", no calendar dates, no
   "filing-ready") are enforced in tool results, validators and the report writer, as the
   drafting gates and `LEGAL_CONCLUSION_PHRASES` already are. Code gates exist only on the
   surfaces a tool writes (the drafting gates, the report writer, the candidate review); chat
   answers have none. So a rule leaves the Workflow Skill text only when every surface it governs
   has a code gate. A rule that also governs chat answers (today: no dollar amounts, "declared"
   never "essential", no calendar dates for the UPC and fee skills, which answer in chat) stays
   under the skill's Doctrine section as well, and an eval case checks the chat surface. Doctrine
   that needs judgment (Phillips vs BRI, what a clean zero means) stays in the Workflow Skill.
   Rejected for now: a response-level gate on chat answers (a new seam; can be added as an
   amendment when a rule needs it).
5. **The app delivers a skill as one package.** When a Workflow Skill loads, the app attaches
   its Tool Guides and the Firm Rules that target it, through the `skill` tool. The model never
   has to find them itself; today's evals depend on "one read gives the full context".
   Rejected: Tool Guides in the system prompt (every request pays for all of them); special
   cases in `read_file`.
6. **The migration is gated by the evals.** First a baseline (the full suite, at least 3 runs
   per case, because one run flakes at 15–25% per case). Then the `skill` tool is turned on with
   the skills unchanged, and the suite runs again. Then one skill moves at a time, starting with
   `patent-search` (its CQL reference becomes the first Tool Guide), and a skill merges only when
   no case gets worse.

## Consequences

- More than 30 places name a skill or its step numbers (tool descriptions, the system prompt,
  `checklist.ts`, tests, evals, drift manifests). Each migration step updates the ones it
  touches. `patentToolReferences.spec.ts` (tool names in skills must be real tools) applies to
  Tool Guides instead of Workflow Skills.
- `/firm-rule` creates Firm Rules. `/create-skill`, `agent-customization` and the New Skill
  flows write a Firm Rule when the user wants to change a Patent Skill, and refuse a Patent
  Skill name before they create a file.
- The Customizations editor shows the Firm Rules for each Patent Skill, and the chat shows which
  Firm Rules a run applied or did not apply.
- The Agents window keeps its own rule (its bundled skills lose to a same-name user skill) until
  its skills merge with the Workflow Skills.
