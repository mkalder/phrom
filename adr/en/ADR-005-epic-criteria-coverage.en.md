# ADR-005: Closing the Epic Criteria Coverage Gap

- **Status:** Accepted
- **Date:** 2026-11-08
- **Decision-maker:** Marius Kalder (Product Owner / Author of Phrom)
- **Scope:** Extending the Epic rule set in `references/criteria/epic-check-criteria.json` before any agent layer is considered

## Context

A code and domain analysis of Phrom (requested before any further extension work) compared each issue type's specified criteria (`references/criteria/*.json`) against what is actually implemented. Epic was the clear outlier: 6 of 18 specified criteria implemented, against 8/9 for Story, 9/11 for Task, and 8/9 for Bug. This gap was already visible as a known limitation in `docs/RULES.en.md` ("Four further expected Epic gaps have no criterion yet") before this decision was made.

At the same time, an externally produced recommendation (not written by the author) proposed building a full "Product Discovery Review Agent" on top of Phrom: a Planner, a Tool Registry, a state machine, quality gates, and a cloud LLM (Gemini) or a local `llama.cpp` runtime. This ADR documents the decision to close the evidenced Epic gap first, following the priority order already laid out in the README's roadmap, rather than building the agent layer directly.

## Decision Drivers

- **Evidence-based prioritization:** the Epic coverage gap is the largest, most demonstrable weakness the analysis found; it is more urgent than any new architecture layer.
- **Architectural continuity:** new criteria should fit the existing `implemented` / `required` / `points` convention from ADR-003 (fail-closed, criteria-JSON-driven, not an agent), not require a new engine.
- **Regression safety:** the seed test set and the `eval-seed.js` regression gate (introduced for CI) must remain the arbiter of correctness for new criteria, not ad-hoc spot checks.
- **Minimal new complexity:** no new dependency, no new model host, no repository split, before the external "agent" recommendation is revisited on its own merits.

## Options Considered

**Option A: Build the externally recommended agent layer directly.** Advantages: matches the external document's "agent" framing. Disadvantages: conflicts with ADR-003 (Phrom is deliberately not an agent); a cloud LLM path (Gemini) conflicts with the project's local-only privacy stance; adds a state machine and tool registry before the simpler, already-planned gaps are closed; the README's existing roadmap already anticipates most of what the agent document asks for, just without the word "agent."

**Option B: Continue the README's already-documented roadmap, starting with the largest evidenced gap (Epic criteria), before any agent layer.** Advantages: each step is additive to the existing architecture and testable with the existing seed/`eval-seed` machinery; closes the most visible weakness first; keeps the "not an agent" and local-only positions intact; is a technical prerequisite for anything more advanced (an agent layer needs reliable state and safe drafts to be worth building). Disadvantages: slower to reach something that reads as "agentic"; less visually impressive than a new architecture diagram.

**Option C: Do both in parallel, in a separate experimental repository.** Advantages: hedges between the two directions. Disadvantages: ADR-002 already found that separating code and demo data across repositories adds friction; a second experimental repository would compound this, and without a concrete need yet, there is nothing for an agent layer to orchestrate.

## Decision

I choose **Option B: close the Epic criteria gap first, as the first step of the existing roadmap.**

- **New criteria** (all `check: "code"`, `required: true`, 10 points each): `epic-context` (reuses `checkContext`'s contract — product and target group must be named, the same bar as Story's `story-context`), `epic-boundary` (explicit in-scope and out-of-scope sections, each with real content), `epic-owner` (one accountable owner named by role or team), `epic-stakeholders` (at least one stakeholder group named).
- **No new architecture:** the four checks are added to `src/checks.js`, wired into `runDeterministicChecks` in `src/agent.js`, and declared in `references/criteria/epic-check-criteria.json` — the exact same pattern already used for Story, Task, and Bug.
- **Seed fixture correction:** the "good control" epic (`seed/issues.json`, seed #1) needed explicit Owner and Stakeholders sections added to its body. The control case should be genuinely complete, not an exception carved into the new rules.
- **Regression gate correction:** `scripts/eval-seed.js`'s `SPEC_TO_KEY.epic` mapping needed four new identity entries (`epic-context`, `epic-boundary`, `epic-owner`, `epic-stakeholders` each mapping to themselves). Without them, the newly correct findings on the weak/oversized epic fixtures were counted as both "not implemented" and "extra" by the gate at once.

Rationale:

- The analysis gave a concrete, evidence-backed priority: Epic was the least-covered type, and the gap was already documented as a known limitation. Closing it needed no new architecture decision of its own — only four more checks in the pipeline ADR-003 already established.
- Doing this work also exercised the regression gate (`eval-seed.js`) built for CI against a real, non-synthetic change, rather than only the deliberately-failing fixture used to verify it initially.

## Consequences

### Positive

- Epic coverage rose from 6/18 to 10/18 specified criteria; Epic's point total rose from 73 to 113 (still normalized to 100 for scoring).
- No architectural change: fits the existing fail-closed, criteria-JSON-driven design exactly; no new dependency, LLM host, or repository.
- The regression gate again matches the seed set exactly (18/18 issues), now validated against a real change.
- Keeps the externally recommended agent architecture available as a later option, once the cheaper, more evidenced gaps are closed — consistent with the roadmap's priority order.

### Negative / Risks

- `epic-context`'s reuse of `checkContext`'s heuristic can pass on text that only incidentally contains product/audience words. Confirmed during this work: "The customer portal should be modern and better" passes `epic-context` because "portal" and "customer" are recognized as whole words, even with no explicit Context section. This is a known, pre-existing limitation of `checkContext` (documented for Story in `docs/RULES.en.md`), now inherited by Epic.
- `epic-owner` and `epic-stakeholders` require an explicit section label ("Owner:", "Stakeholders:"); an epic that names an owner only in prose, without a label, will fail — the same structure-not-meaning limitation already documented for other deterministic checks.
- Four more required criteria raise the bar for the Epic Ready Gate; an existing epic in a real backlog that previously scored 🟢 may need an Owner/Stakeholders section added before it passes again.
- `epic-boundary`, `epic-owner`, and `epic-stakeholders` already appeared, at the specification level, in `epic-check-criteria.json`'s `examples` array before this change. This ADR records their move from "specified" to "implemented," not a new specification decision.

## Validation

The decision is considered validated when:

- `npm test` passes, including the new `checkEpicContext` / `checkEpicBoundary` / `checkEpicOwner` / `checkEpicStakeholders` unit tests and the updated `evaluate()` tests for Epic,
- `node scripts/eval-seed.js` returns exit code 0 against the full 18-issue seed set,
- README.md / README.de.md and docs/RULES.en.md / .de.md describe the four new criteria and the updated Epic point total (113),
- the "good control" epic fixture still passes the Ready Gate with the new criteria applied.

## Open Questions

- Whether `epic-owner` and `epic-stakeholders` should eventually be split into formal (structure) and AI (meaning) pairs, the way `goal-statement`/`epic-goal` and `benefit-statement`/`epic-benefit` already are, is open; for now they stay purely deterministic, keeping the Ready Gate's required criteria cheap to check.
- `epic-success-measure`, `epic-slicing`, and the remaining `implemented: false` Epic criteria (company goal, milestones, timeline, risks, dependencies, child-story status) are not addressed by this ADR; they remain planned.
- Whether the roadmap's next step (status tracking / retry / resume) or the externally recommended agent layer should follow is a separate decision, not made here.
