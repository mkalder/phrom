# Phrom Rules

**Version:** 0.3.1
**Date:** 2026-10-08 (document revision; first published for 0.3.1 on 2026-10-07)
**Changes from 0.3.0:** descriptions and pass conditions in the JSON files now match the implementation; points and required flags are unchanged.
**Document revision 2026-10-08:** examples and limitations are based on the test day of 2026-10-08; the exact trigger conditions of `technical-scope` and `impact-analysis` and their known side effects are documented. Criteria, points and required flags are unchanged.
**Epic criteria extended 2026-11-08:** four new deterministic criteria (`epic-context`, `epic-boundary`, `epic-owner`, `epic-stakeholders`) were added to Epic; its total points rose from 73 to 113. See [ADR-005](../adr/en/ADR-005-epic-criteria-coverage.en.md).
**AI backend switched 2026-11-08:** AI calls now go through an OpenAI-compatible endpoint (`LITELLM_HOST`, a self-hosted LiteLLM instance in this project's deployment) instead of a local Ollama host; `OLLAMA_HOST` and `top_k` are gone. See [ADR-006](../adr/en/ADR-006-litellm-backend.en.md).
**Scope:** Pre-refinement assessment of GitHub Issues

This document describes what Phrom checks, how the score is calculated, and when an issue is considered "Ready." It is **not a Definition of Done** and does not decide sprint readiness. The criteria themselves are stored in machine-readable form in `references/criteria/*.json`, from which point weights and required flags are read.

---

## Table of Contents

- [Overview](#overview)
- [Type Detection](#type-detection)
- [Score and Ready Gate](#score-and-ready-gate)
- [Criteria by Type](#criteria-by-type)
- [Deterministic Check Rules](#deterministic-check-rules)
- [AI Checks](#ai-checks)
- [Quick Status (`phrom status`)](#quick-status-phrom-status)
- [Examples](#examples)
- [Limitations of the Assessment](#limitations-of-the-assessment)
- [Planned Criteria](#planned-criteria)

---

## Overview

Phrom assesses each issue on two levels:

1. **Score (0–100):** The proportion of achieved points to achievable points.
2. **Ready Gate:** All criteria marked as **required** must pass.

| Status | Condition |
| --- | --- |
| 🟢 Ready | Ready Gate passed **and** Score ≥ 80 |
| 🟡 Needs work | Ready Gate passed **and** Score 50–79 |
| 🔴 Not ready | Ready Gate not passed **or** Score < 50 |

**The Ready Gate overrides the score.** If a required criterion fails, the issue is 🔴 regardless of its point total. The score shows progress; the gate decides.

There are two types of criteria:

- **Deterministic (`code`):** Rule-based checks implemented in code, executed in milliseconds, and reproducible.
- **AI (`model`):** A model served through the configured LLM endpoint (`LITELLM_HOST`) provides a reasoned assessment. This is an assessment, not a fact.

"Ready for refinement" is not the same as "ready for sprint planning." Phrom does not prioritize, estimate, or confirm technical feasibility.

---

## Type Detection

The type determines which criteria apply.

1. **Label:** `type:epic`, `type:story`, `type:task`, or `type:bug`.
2. **Fallback when a label is missing:** The model assigns the issue to exactly one of the four types, including confidence `high`, `medium`, or `low` and a reason. This fallback is used in `run`, `select`, and `improve`.
3. `phrom filter <type>` considers only issues with a label. `phrom status` applies Story checks when no label is present.

Example from the test day of 2026-10-08: issue #19 has no label and was classified by the model as Task (confidence `high`) and then assessed with the Task criteria. This shows that the fallback works; whether its assignments are reliable has not been evaluated. Set labels yourself.

---

## Score and Ready Gate

**Score** = `round(achieved points ÷ achievable points × 100)`

- A criterion awards its points either fully or not at all.
- Only criteria that are implemented (`implemented` is not `false`) and carry points are achievable.
- The sum of points per type is stored in `scoring.totalPoints` in the respective JSON file. Story and Task total 100, Epic totals 113, and Bug totals 105; the score is therefore normalized to 100.

**Ready Gate:** A result must exist for every required criterion **and** it must pass. If a result is missing, for example because the configured LLM endpoint is unavailable, the criterion is considered not passed. The issue is then marked as 🔴.

```javascript
function calculateStatus(score, gateFailed) {
  if (gateFailed) return { status: "not-ready", emoji: "🔴" };
  if (score >= 80) return { status: "ready", emoji: "🟢" };
  if (score >= 50) return { status: "needs-work", emoji: "🟡" };
  return { status: "not-ready", emoji: "🔴" };
}
```

**When is 🟡 achievable?** Only when required criteria account for less than 80% of total points. This is the case for **Story** (required = 47 out of 100 points). For Task (90%), Epic (100%), and Bug (81%), a passed gate always results in a score of at least 80; for those types, the status is effectively 🟢 or 🔴.

Examples from the run on 2026-10-08: "Reset password" (#4) scores 80 and "Download invoice" (#11) scores 90, yet both are 🔴 because a required criterion fails (`story-context` and `ac-presence`). "Change payment method" (#8) scores 90 and is 🟢 although the epic reference is missing, because `epic-link` is optional.

Because `story-links` always passes for a non-empty body, a Story with a passed gate scores at least 57. The "score < 50" branch of 🔴 is therefore never reached with a passed gate, for any type: in practice, 🔴 always means that the Ready Gate failed.

| Type | Required Points | Total Points | Required Share | 🟡 possible |
| --- | ---: | ---: | ---: | :---: |
| Story | 47 | 100 | 47% | ✅ |
| Task | 90 | 100 | 90% | – |
| Epic | 113 | 113 | 100% | – |
| Bug | 85 | 105 | 81% | – |

---

## Criteria by Type

Points, type, and required status per criterion. ✅ = required (Ready Gate), “–” = optional (counts only in the score).

### Story (100 points)

| Criterion | Type | Points | Required |
| --- | --- | ---: | :---: |
| `story-format` | Rule | 10 | ✅ |
| `story-context` | Rule | 10 | ✅ |
| `epic-link` | Rule | 10 | – |
| `ac-presence` | Rule | 10 | ✅ |
| `story-links` | Rule | 10 | – |
| `ac-testability` | AI | 17 | ✅ |
| `size-risk` | AI | 17 | – |
| `business-value` | AI | 16 | – |

Stories can exist without an epic, for example bug fixes, spikes, or small features. The epic link is therefore a recommendation for traceability, not a requirement. `size-risk` is a risk signal, not an estimate or a team commitment.

### Task (100 points)

| Criterion | Type | Points | Required |
| --- | --- | ---: | :---: |
| `technical-scope` | Rule | 15 | ✅ |
| `justification` | Rule | 10 | ✅ |
| `impact-analysis` | Rule | 10 | ✅ |
| `rollback-plan` | Rule | 10 | ✅ |
| `ac-presence` | Rule | 5 | – |
| `ac-testability` | AI | 20 | ✅ |
| `size-risk` | AI | 15 | ✅ |
| `technical-feasibility` | AI | 10 | ✅ |
| `rollback-risk` | AI | 5 | – |

### Bug (105 points, normalized to 100)

| Criterion | Type | Points | Required |
| --- | --- | ---: | :---: |
| `reproduction-steps` | Rule | 15 | ✅ |
| `expected-vs-actual` | Rule | 15 | ✅ |
| `environment-info` | Rule | 10 | ✅ |
| `ac-presence` | Rule | 10 | – |
| `ac-testability` | AI | 20 | ✅ |
| `size-risk` | AI | 15 | ✅ |
| `severity` | AI | 10 | ✅ |
| `reproducibility` | AI | 10 | – |

### Epic (113 points, normalized to 100)

| Criterion | Type | Points | Required |
| --- | --- | ---: | :---: |
| `goal-statement` | Rule | 15 | ✅ |
| `benefit-statement` | Rule | 15 | ✅ |
| `story-list` | Rule | 10 | ✅ |
| `size-risk` | AI | 17 | ✅ |
| `epic-goal` | AI | 8 | ✅ |
| `epic-benefit` | AI | 8 | ✅ |
| `epic-context` | Rule | 10 | ✅ |
| `epic-boundary` | Rule | 10 | ✅ |
| `epic-owner` | Rule | 10 | ✅ |
| `epic-stakeholders` | Rule | 10 | ✅ |

---

## Deterministic Check Rules

All deterministic checks operate on the issue body and are case-insensitive. An empty body causes every deterministic check to fail.

### Story

**`story-format`** passes if the text follows a known pattern or contains all three components:

- German: "Als … möchte ich … damit …", "… um … zu …", "… will ich … damit …"
- English: "As a … I want … so that …", "… in order to …", "As a … I need … so that …", "… I should be able to … so that …"
- Alternative order: "In order to …, as a … I want …" and "Um … zu …, als … möchte ich …".
- Fallback: role ("als" or "as" followed by a word, optionally "as a"), desire (möchte, will, want, need, should be able to), and benefit (damit, um … zu, so that, in order to) appear anywhere in the text, even without a standard formulation.

**`story-context`** passes when both a **product** (for example product, feature, system, portal, app, platform, service) and a **target group** (for example user, customer, client, admin, kunde, benutzer) occur as whole words. The role in the story sentence ("As a customer") counts as a target group, but a product must additionally be named, for example in a line such as `Context: Customer Portal, residential customers`. Business terms (value, goal, need, and so on) do not count; benefit is assessed by `business-value` (AI).

**`epic-link`** passes if an issue reference (`#12` or `owner/repo#12`) is present and either:

- exactly one reference exists, which is considered the likely parent epic; or
- multiple references exist and an epic context word occurs (epic, parent, part of, belongs to, under, related to, tracking, initiative).

The existence of the referenced epic in GitHub is not verified.

**`ac-presence`** counts acceptance criteria in three ways and uses the maximum: checklist items (`- [ ] …`), Gherkin scenarios (lines with Given/When/Then/And/But; three lines ≙ one scenario), and occurrences of "must", "should", "verify that", or "it is required that". It passes with **at least two** criteria, at least one of which covers an **error, empty-state, or authorization case** (error, invalid, fail, empty, "no …", "not signed in", expired, redirected, and so on). It checks the criterion text, not the entire body. If neither checklist items, Gherkin lines nor an AC section exist, the count comes only from "must/should" statements; the report then says "No acceptance criteria found (only n 'must/should' statement)".

**`story-links`** passes for every non-empty body. Recognized patterns (depends on, blocked by, requires, blocks, related to, see also, duplicate of) are output as a hint. There is no deduction for missing links; the 10 points are therefore effectively always awarded.

### Task

**`technical-scope`** passes if a "What / Scope / Technical Scope" section (heading, bold label, or `Label:`) or a list with action verbs is present and at least **two** lines starting with `-` or `*` contain an action verb (upgrade, migrate, implement, create, update, configure, refactor, deploy, setup, install, remove, add). Lines anywhere in the body count, not only inside the scope section. Because bold labels also start with `*`, a line such as `**Task:** Migrate …` is counted as a work item; two such label lines can therefore pass the check without a real list.

**`justification`** passes if a rationale section (Why, Reason, Justification, Background, Motivation; heading or label) or a keyword occurs **and** a concrete trigger is named: EOL/year/quarter (eol, end-of-life, `Q1`–`Q4`, `202x`), security, performance, or compliance. "debt" or "deprecated" alone are not sufficient.

**`impact-analysis`** passes if an impact section (heading Impact, Affected, Downtime, Risks) or one of the keywords "affected systems", "downtime", "maintenance window" or "rollback" occurs **and** at least **two of three** elements are named anywhere in the body: affected systems (affected systems, databases, services), downtime (downtime, window, maintenance), and risks (risk, risks).

Known side effect: the word "rollback" alone triggers the second step, so an issue with a rollback plan but no impact section receives the message "Impact section exists but incomplete". If exactly one element is found, the message names it as found and, because the text is fixed, also as missing ("Found: affected systems. Missing: affected systems + downtime/risks."). The result is correct in the recorded cases; the reason text is misleading.

**`rollback-plan`** passes if a "Rollback" section (heading or label) exists **and** at least **two of four** details are named: procedure (procedure, steps, restore, backup), test (tested, test), time estimate (for example "15 minutes" or "within 30"), and location (runbook, documented in, location).

**`ac-presence`:** as for Story.

### Bug

**`reproduction-steps`** passes if a reproduction section, a numbered list, or "Step n" occurs and at least **two** numbered steps or "Step" markers are present.

**`expected-vs-actual`** passes if "expected" occurs and additionally "actual", "instead", or "but got".

**`environment-info`** passes if an environment section or a keyword (browser, os, version, device, platform, ios, android, windows, mac, safari, chrome, firefox) occurs and at least **two** details are recognized: Browser, OS, Version, or Device/Platform.

**`ac-presence`:** as for Story.

### Epic

**`goal-statement`** passes if a goal section (heading `## Goal`, label `**Goal:**`, or `Goal:`; also Objective, Aim, Purpose) containing at least five words is present, or the text contains "goal is to" / "objective is to". Only structure is checked. Whether the goal describes an outcome is assessed by `epic-goal` (AI); measurable goals and dates are output as a hint.

**`benefit-statement`** passes if a benefit section (Benefit, Value, Impact, Outcome as heading or label) containing at least five words is present, or the text contains "benefit is/will be". Only structure is checked; whether the benefit is understandable is assessed by `epic-benefit` (AI). Quantification is output as a hint.

**`story-list`** passes if at least **two** issue references (`#n`) occur in the body or a section named "Stories", "Child Stories", "Candidate Stories", or "Slices" contains at least **two** list items.

**`epic-context`** shares `story-context`'s contract and implementation (`checkContext`): a product and a target group must be named as whole words. As with Story, incidental matches (for example "portal" and "customer" occurring anywhere in the text) are sufficient; no explicit "Context" section is required.

**`epic-boundary`** passes if both an "In Scope" and an "Out of Scope" section (heading or label) are present and each contains at least three words of real content.

**`epic-owner`** passes if an "Owner" section (heading or label) is present and non-empty. A role or team name is expected (for example "Owner: Jane Doe, Platform Team") but is not parsed separately from the rest of the section.

**`epic-stakeholders`** passes if a "Stakeholders" section (heading or label) is present and non-empty. One or more stakeholder groups can be listed, for example as bullets.

---

## AI Checks

AI checks run through the OpenAI-compatible endpoint in `LITELLM_HOST` (no default; must be set) with the model in `MODEL_NAME` (default `qwen3:30b-instruct`). `LITELLM_HOST` is always reached over the network. Content stays only within infrastructure you operate if you self-host that endpoint and the model behind it; it does not stay "on this machine" the way a local Ollama setup did. See [ADR-006](../adr/en/ADR-006-litellm-backend.en.md).

**Technical details:**

- Responses are JSON according to a fixed schema (Structured Output), with no free-text parsing.
- `temperature: 0` and `seed: 42` are used for as consistent results as possible on the same setup. There is no bit-exact guarantee across hardware or model versions. The previous Ollama-based setup also sent `top_k: 1`; the OpenAI-compatible API used since [ADR-006](../adr/en/ADR-006-litellm-backend.en.md) has no equivalent parameter, so it is no longer sent, and whether `temperature: 0` plus `seed` alone reproduce comparable determinism has not been re-measured.
- Up to two retries are attempted on errors, with a 2 s and 4 s wait time respectively.
- Each check returns a short reason in the language of the issue.
- Prompts for `size-risk`, `technical-feasibility`, and `severity` instruct the model to assess only the issue text and not assume technologies or platforms that are not mentioned.
- If the configured LLM endpoint fails, AI results are missing. Required criteria are then treated as not passed (fail-closed).

| Criterion | Types | Passes when … |
| --- | --- | --- |
| `ac-testability` | Story, Task, Bug | All acceptance criteria are clear, measurable, unambiguous, and testable. Vague wording such as "works well" or "user-friendly", and missing criteria, fail. |
| `size-risk` | All | Estimated size is **S** or **M** (S: < 1 day, low risk; M: 1–3 days, open questions; L: 3–10 days; XL: > 10 days). The prompt contains type-specific breadth indicators from the criteria JSON, for example multiple independent goals, multiple platforms, or "all" / "complete" without a boundary. It instructs the model to judge breadth: if no indicator clearly applies, the result is S or M even when the work is substantial. L and XL fail. The day-based scale makes the rating concrete; the result is a risk signal, not an estimate the team has to accept. In the seed expectations for Epics, this criterion appears as `epic-oversize-risk`. |
| `business-value` | Story | A user or role, a concrete need, and an understandable benefit from the user's perspective are identifiable. Business KPIs are not required. "Improve X" without a benefit fails. |
| `epic-goal` | Epic | The goal describes an outcome for the business or user, not merely a topic. |
| `epic-benefit` | Epic | The benefit is understandable: who gains what, ideally measurably. |
| `technical-feasibility` | Task | The technical approach is feasible and understood; substantial technical uncertainty fails. |
| `rollback-risk` | Task | The rollback is appropriate for the production impact; an untested rollback fails. |
| `severity` | Bug | Severity (Critical, Major, Minor) is clearly justified. |
| `reproducibility` | Bug | Reproducibility (Always, Sometimes, Rarely) is clearly stated. |

AI results are marked as `(ai)` in reports and drafts; deterministic results are marked as `(deterministic)`.

---

## Quick Status (`phrom status`)

`phrom status` runs **only deterministic checks**. It does not know AI criteria, point weights, or the Ready Gate, and it is **not a readiness verdict**.

- Value = `round(passed checks ÷ number of checks × 50)`
- Bands: 🟢 at least 80% of formal checks passed (value ≥ 40), 🟡 50–79% (≥ 25), 🔴 below 50%
- Additionally: the number of issues that pass **all** formal checks

🟢 here does not mean "no formal gaps": an issue with 4 of 5 checks passed is 🟢 even if the failed check is required. It can also be 🔴 in the full analysis, for example because its acceptance criteria are not testable. Only the assessment with AI (`run`, `select`, `filter`, `improve`) applies the Ready Gate.

---

## Examples

All examples come from the `phrom run` on 2026-10-08 against the demo repository.

### Issue #3 "Improve login" (Story): 10/100, 🔴 Not ready

| Criterion | Result | Points |
| --- | :---: | ---: |
| `story-format` | ✖ | 0 |
| `story-context` | ✖ | 0 |
| `epic-link` | ✖ | 0 |
| `ac-presence` (no criteria; one "should" statement) | ✖ | 0 |
| `story-links` | ✔ | 10 |
| `ac-testability` | ✖ | 0 |
| `size-risk` | ✖ | 0 |
| `business-value` | ✖ | 0 |
| **Total** | | **10** |

The Ready Gate fails on four required criteria: the rule criteria `story-format`, `story-context` and `ac-presence`, and the AI criterion `ac-testability`.

### Issue #7 "View invoice overview" (Story): 100/100, 🟢 Ready

All five formal checks pass—story format, context (`Self-Service Customer Portal, residential customers`), epic reference, three acceptance criteria including an empty state, and story links—as do all three AI checks.

### Calculation Example: The Gate Overrides the Score

A Story passes everything except `ac-testability` (17 points, required). Its score is 83, which would fall in the 🟢 range. Because a required criterion fails, the issue is still 🔴 Not ready: untestable acceptance criteria such as "All options" and "the change is applied" do not make an issue ready for refinement, even if it is otherwise formally complete.

---

## Limitations of the Assessment

- **Heuristics:** Deterministic checks recognize keywords and patterns, not meaning. A text can pass without being good, and vice versa.
- **Keywords:** Product and target group are recognized through word lists; whole words, plural forms, and German endings are tolerated. A product not included in the list, for example "Dashboard," is not recognized and causes `story-context` to fail.
- **Languages:** Formats and keywords are designed for German and English.
- **Epic link:** The existence of the epic and the backlink in GitHub are not verified.
- **AI assessments** are reasoned opinions. They can be wrong, and their quality depends on the model. On the test day of 2026-10-08, the rule-based checks matched the 18-issue seed test set exactly (18/18 issues, 31/31 expected gaps, no additional findings). With AI, all 45 checkable expected gaps were found, none of the 5 control issues was flagged, and there were 15 additional findings on weak issues. One further expected Epic gap has no criterion yet (success measure; see Planned Criteria). The prompts were tuned on the same issues; an independent test set is outstanding.
- **AI reasons can drift from the criterion:** for example, a missing statement can be read as "no risk" (`technical-feasibility` passed for #9 because "no external dependencies or risks are mentioned"), or a missing label can be judged as a process problem (`rollback-risk` for #19).
- **Reason texts are not evaluated:** the evaluation checks which criteria fail, not whether the reason shown is correct (see `technical-scope` and `impact-analysis` above).
- **No failure status:** If the model fails, the issue is fail-closed as 🔴. A separate `incomplete` status is planned.
- **Report summary:** It names the most important gaps but is not a complete list. The criteria list in the report is authoritative.

---

## Planned Criteria

These criteria are described in `references/criteria/*.json` with `implemented: false` but are not yet implemented. They carry no points and do not affect the Ready Gate.

| Type | Criteria |
| --- | --- |
| Story | `independence` (overlap with other Stories through similarity search) |
| Task | `task-context`, `task-dependencies` |
| Bug | `bug-impact` |
| Epic | `epic-success-measure`, `epic-slicing`, `epic-company-goal`, `epic-milestones`, `epic-timeline`, `epic-risks`, `epic-dependencies`, `epic-child-story-status` |

Further planned rules from the JSON files:

- **Three-valued result** (`plannedResultValues`: `pass`, `flag`, `not-assessable`) instead of `pass / fail`.
- **Evidence requirement** (`plannedRequireEvidence`): The AI cites the passage on which its assessment is based.
- **Status `incomplete`** (`plannedAssessmentIncomplete`, Epic) when the configured LLM endpoint is unavailable or AI checks fail; such a run must be repeated.
