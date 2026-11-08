/**
 * model.js – AI checks for all issue types, via the shared chat-completions client.
 *
 * Uses the shared client from llm-client.js, so LITELLM_HOST and MODEL_NAME from .env are the
 * endpoint and model that are actually called (see ADR-006).
 *
 * Check names are identical to the criterion IDs (kebab-case).
 */

import { chatCompletion, MODEL_NAME } from "./llm-client.js";
import { loadCriteria } from "./criteria-loader.js";

// Keeps judgments tied to the issue text: models otherwise reason from general knowledge
// (e.g. "Mobile Safari has known limitations …") and rate items on facts the issue never states.
const GROUNDING =
  "Judge only from the text of the issue. Do not assume technologies, platforms, systems or facts that the text does not mention.";

/**
 * askModel(prompt, schema) – Führt einen Modell-Call mit Structured Output aus.
 */
async function askModel(prompt, schema) {
  const content = await chatCompletion({
    messages: [{ role: "user", content: prompt }],
    format: schema,
    options: { temperature: 0, seed: 42 },
  });

  return JSON.parse(content);
}

/**
 * askModelWithRetry(prompt, schema, retries) – Mit einfachem Retry.
 */
async function askModelWithRetry(prompt, schema, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await askModel(prompt, schema);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/**
 * Helper: Issue-Kontext als Prompt-Block.
 */
function issueBlock(issue) {
  return `## Issue #${issue.number}: ${issue.title}\n\n${issue.body || "(empty body)"}`;
}

// ---------------------------------------------------------------------------
// JSON-Schemas pro Check-Dimension
// ---------------------------------------------------------------------------

const PASS_FAIL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["passed", "reason"],
};

const SIZE_RISK_SCHEMA = {
  type: "object",
  properties: {
    size: { type: "string", enum: ["S", "M", "L", "XL"] },
    reason: { type: "string" },
  },
  required: ["size", "reason"],
};

const TYPE_INFERENCE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["story", "epic", "task", "bug"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string" },
  },
  required: ["type", "confidence", "reason"],
};

// ---------------------------------------------------------------------------
// Check-Funktionen (alle Typen: Story, Task, Bug, Epic)
// ---------------------------------------------------------------------------

/**
 * checkAcTestability(issue) – Prüft, ob Acceptance Criteria testbar sind.
 */
export async function checkAcTestability(issue) {
  const prompt = `You are a senior QA engineer reviewing a backlog item.
Evaluate whether the acceptance criteria of this issue are testable:
clear, measurable, unambiguous, and verifiable (no vague wording like
"works well" or "is user-friendly"). If there are no acceptance criteria
at all, the check fails.

${issueBlock(issue)}

Respond as JSON: passed = true if all acceptance criteria are testable,
false otherwise. Give a short reason (1-2 sentences, in the language of the issue).`;

  return askModelWithRetry(prompt, PASS_FAIL_SCHEMA);
}

/**
 * checkSizeRisk(issue) – Schätzt Aufwand/Risiko des Items.
 */
export async function checkSizeRisk(issue, indicators = []) {
  // The criteria spec defines size-risk by breadth ("too broad for one sprint"), not by effort in days.
  const breadthRule = indicators.length
    ? "\nDecide mainly by breadth: if none of the signs above clearly applies, answer S or M, even if the work is substantial. "
      + "Answer L or XL only if one or more signs clearly apply or the text itself describes work that cannot fit into one sprint.\n"
    : "";
  const indicatorBlock = indicators.length
    ? `\nSigns that an item is too broad for one sprint (rate it L or XL if one or more clearly apply):\n${indicators.map((i) => `- ${i}`).join("\n")}\n`
    : "";

  const prompt = `You are an experienced software project lead estimating backlog items.
Estimate the implementation effort and risk of this issue.
${GROUNDING}
Use the following scale:
- S: small, well understood, < 1 day, low risk
- M: medium, 1-3 days, some open questions
- L: large, 3-10 days, significant uncertainty or dependencies
- XL: too large, must be split, > 10 days or many unknowns
${indicatorBlock}${breadthRule}
${issueBlock(issue)}

Respond as JSON: size (S/M/L/XL) and a short reason (1-2 sentences, in the language of the issue).`;

  const result = await askModelWithRetry(prompt, SIZE_RISK_SCHEMA);
  return { ...result, passed: result.size === "S" || result.size === "M" };
}

/**
 * checkBusinessValue(issue) – Bewertet den Business-Wert einer Story.
 * NOTE: Renamed from checkValue to checkBusinessValue for clarity.
 */
export async function checkBusinessValue(issue) {
  const prompt = `You are a product owner reviewing a user story.
Evaluate whether this story clearly communicates value for the user:
a specific user or role, a concrete need, and an understandable benefit.
A benefit stated from the user's point of view ("so that ...") is sufficient. Do not require business KPIs,
metrics or company-level goals, and do not invent value that the text does not state.
Vague stories like "improve X" without a stated benefit fail this check.

${issueBlock(issue)}

Respond as JSON: passed = true if the business value is clearly stated,
false otherwise. Give a short reason (1-2 sentences, in the language of the issue).`;

  return askModelWithRetry(prompt, PASS_FAIL_SCHEMA);
}

/**
 * checkEpicGoal(issue) – Prüft, ob ein Epic ein klares Ziel hat.
 */
export async function checkEpicGoal(issue) {
  const prompt = `You are a product owner reviewing an epic.
Evaluate whether this epic has a clearly formulated goal:
what problem it solves or which outcome it achieves for the business or user.
Epics that only list topics without a goal fail this check.

${issueBlock(issue)}

Respond as JSON: passed = true if the goal is clear, false otherwise.
Give a short reason (1-2 sentences, in the language of the issue).`;

  return askModelWithRetry(prompt, PASS_FAIL_SCHEMA);
}

/**
 * checkEpicBenefit(issue) – Prüft, ob ein Epic einen nachvollziehbaren Nutzen formuliert.
 */
export async function checkEpicBenefit(issue) {
  const prompt = `You are a product owner reviewing an epic.
Evaluate whether this epic states a comprehensible benefit:
who gains what from completing it, ideally in a measurable or at least
plausible form. Epics without a stated benefit fail this check.

${issueBlock(issue)}

Respond as JSON: passed = true if the benefit is clear, false otherwise.
Give a short reason (1-2 sentences, in the language of the issue).`;

  return askModelWithRetry(prompt, PASS_FAIL_SCHEMA);
}

/**
 * inferType(issue) – Fallback-Typermittlung per Modell (bei unbekannten Labels).
 */
export async function inferType(issue) {
  const prompt = `You are a project manager triaging a backlog item.
Classify this issue into exactly one type:
- epic: a large initiative spanning multiple stories
- story: a user-facing requirement with value for a user
- task: technical work without direct user value (e.g. migration, refactoring)
- bug: a defect report describing broken behavior

${issueBlock(issue)}

Respond as JSON: type, your confidence (high/medium/low),
and a short reason (1-2 sentences, in the language of the issue).`;

  return askModelWithRetry(prompt, TYPE_INFERENCE_SCHEMA);
}

// =============================================================================
// TASK-SPECIFIC AI CHECKS
// =============================================================================

/**
 * checkTechnicalFeasibility(issue) – Bewertet technische Machbarkeit.
 */
export async function checkTechnicalFeasibility(issue) {
  const prompt = `You are a senior engineer evaluating a technical task.
Assess whether the technical approach is feasible and well-understood.
${GROUNDING}

Consider:
- Is the technical scope clear and achievable?
- Are dependencies and risks identified?
- Is the team likely to have the required skills?

${issueBlock(issue)}

Respond as JSON: passed = true if the approach is feasible and well-understood,
false if there are significant technical uncertainties. Give a short reason.`;

  return askModelWithRetry(prompt, PASS_FAIL_SCHEMA);
}

/**
 * checkRollbackRisk(issue) – Bewertet Rollback-Risiko.
 */
export async function checkRollbackRisk(issue) {
  const prompt = `You are a senior engineer evaluating rollback risk for a technical task.
Assess whether the rollback plan is adequate for the production impact.

Consider:
- Is rollback tested or just documented?
- Is the estimated rollback time reasonable?
- Does the task involve data migration (higher risk) or just configuration?

${issueBlock(issue)}

Respond as JSON: passed = true if rollback risk is acceptable,
false if rollback is untested or inadequate for the impact. Give a short reason.`;

  return askModelWithRetry(prompt, PASS_FAIL_SCHEMA);
}

// =============================================================================
// BUG-SPECIFIC AI CHECKS
// =============================================================================

/**
 * checkSeverity(issue) – Bewertet die Bug-Schwere (Critical/Major/Minor).
 */
export async function checkSeverity(issue) {
  const prompt = `You are a senior QA engineer assessing bug severity.
${GROUNDING}
Evaluate the severity of this bug based on:
- Impact on users (how many affected?)
- Impact on business (revenue, compliance, reputation)
- Workaround availability (is there a temporary fix?)

Severity scale:
- Critical: System down, data loss, security breach, compliance violation
- Major: Core feature broken, significant user impact, no workaround
- Minor: Edge case, cosmetic issue, workaround available

${issueBlock(issue)}

Respond as JSON: { severity: "Critical"|"Major"|"Minor", passed: true ONLY if the issue itself states or clearly implies the impact (who is affected, business effect, workaround) that justifies the severity; false if the issue gives no impact information, even if you can guess a severity, reason: "1-2 sentences" }.`;

  const schema = {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["Critical", "Major", "Minor"] },
      passed: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["severity", "passed", "reason"],
  };

  return askModelWithRetry(prompt, schema);
}

/**
 * checkReproducibility(issue) – Bewertet, wie reproduzierbar der Bug ist.
 */
export async function checkReproducibility(issue) {
  const prompt = `You are a senior QA engineer assessing bug reproducibility.
Evaluate how reproducible this bug is based on the provided steps:
- Are the steps clear and detailed?
- Is the environment specified?
- Is the frequency mentioned (always/sometimes/rarely)?

Reproducibility scale:
- Always: Bug occurs 100% of the time with given steps
- Sometimes: Bug occurs intermittently (50-90%)
- Rarely: Bug is hard to reproduce (<50%)
- Unknown: Insufficient information

${issueBlock(issue)}

Respond as JSON: { reproducibility: "Always"|"Sometimes"|"Rarely"|"Unknown", passed: true if reproducibility is clearly stated, false otherwise, reason: "1-2 sentences" }.`;

  const schema = {
    type: "object",
    properties: {
      reproducibility: { type: "string", enum: ["Always", "Sometimes", "Rarely", "Unknown"] },
      passed: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["reproducibility", "passed", "reason"],
  };

  return askModelWithRetry(prompt, schema);
}

// =============================================================================
// MAIN: runModelChecks(issue, type)
// =============================================================================

/**
 * runModelChecks(issue, type) – Führt alle passenden Modell-Checks für ein Issue aus.
 * 
 * NOTE: Keys entsprechen jetzt den Criteria-IDs (Kebab-Case).
 */
export async function runModelChecks(issue, type) {
  const results = {};

  // Common checks. Epics have no acceptance criteria by design, so they skip ac-testability.
  if (type !== "epic") {
    results["ac-testability"] = await checkAcTestability(issue);
  }
  // Broadness indicators come from the criteria catalog, so the prompt follows the documented rule.
  const sizeIndicators = loadCriteria(type)?.criteria?.find((c) => c.id === "size-risk")?.indicators ?? [];
  results["size-risk"] = await checkSizeRisk(issue, sizeIndicators);

  // Type-specific checks
  if (type === "story") {
    results["business-value"] = await checkBusinessValue(issue);
  } else if (type === "epic") {
    results["epic-goal"] = await checkEpicGoal(issue);
    results["epic-benefit"] = await checkEpicBenefit(issue);
  } else if (type === "task") {
    results["technical-feasibility"] = await checkTechnicalFeasibility(issue);
    results["rollback-risk"] = await checkRollbackRisk(issue);
  } else if (type === "bug") {
    results.severity = await checkSeverity(issue);
    results.reproducibility = await checkReproducibility(issue);
  }

  return results;
}

export { MODEL_NAME };