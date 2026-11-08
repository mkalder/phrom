/**
 * agent.js – Phrom assessment pipeline (fixed steps, all issue types).
 *
 * Reads issues from GitHub, runs deterministic and AI checks based on the criteria catalogs,
 * calculates score, Ready Gate, status and summary, and saves the results with a timestamp.
 *
 * This is a fixed pipeline, not an agent: the model never chooses the next step.
 * (The file name is kept for compatibility with existing imports.)
 *
 * No improvement suggestions here – those belong to cli.js (phrom improve).
 */

import "dotenv/config";
import { listIssues, getIssue } from "./tools.js";
import {
  // Story checks
  checkStoryFormat,
  checkContext,
  checkEpicLink,
  checkACPresence,
  checkStoryLinks,
  // Task checks
  checkTechnicalScope,
  checkJustification,
  checkImpactAnalysis,
  checkRollbackPlan,
  // Bug checks
  checkReproductionSteps,
  checkExpectedVsActual,
  checkEnvironmentInfo,
  // Epic checks
  checkGoalStatement,
  checkBenefitStatement,
  checkStoryList,
  checkEpicContext,
  checkEpicBoundary,
  checkEpicOwner,
  checkEpicStakeholders,
} from "./checks.js";
import { runModelChecks, inferType } from "./model.js";
import { generateMarkdownReport, generateSummaryReport } from "./report.js";
import { loadCriteria } from "./criteria-loader.js";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

/**
 * determineType(labels) – Type from the type:* label, otherwise "unknown".
 */
export function determineType(labels) {
  if (!labels || !Array.isArray(labels)) {
    return "unknown";
  }

  const labelNames = labels.map((l) => (l && l.name ? l.name.toLowerCase() : ""));

  if (labelNames.includes("type:epic")) return "epic";
  if (labelNames.includes("type:story")) return "story";
  if (labelNames.includes("type:task")) return "task";
  if (labelNames.includes("type:bug")) return "bug";

  return "unknown";
}

/**
 * runDeterministicChecks(issue, type) – Type-specific deterministic checks (keys = criterion IDs).
 */
export function runDeterministicChecks(issue, type) {
  if (type === "story") {
    return {
      "story-format": checkStoryFormat(issue.body),
      "story-context": checkContext(issue.body),
      "epic-link": checkEpicLink(issue.body),
      "ac-presence": checkACPresence(issue.body),
      "story-links": checkStoryLinks(issue.body),
    };
  } else if (type === "task") {
    return {
      "technical-scope": checkTechnicalScope(issue.body),
      "justification": checkJustification(issue.body),
      "impact-analysis": checkImpactAnalysis(issue.body),
      "rollback-plan": checkRollbackPlan(issue.body),
      "ac-presence": checkACPresence(issue.body),
    };
  } else if (type === "bug") {
    return {
      "reproduction-steps": checkReproductionSteps(issue.body),
      "expected-vs-actual": checkExpectedVsActual(issue.body),
      "environment-info": checkEnvironmentInfo(issue.body),
      "ac-presence": checkACPresence(issue.body),
    };
  } else if (type === "epic") {
    return {
      "goal-statement": checkGoalStatement(issue.body),
      "benefit-statement": checkBenefitStatement(issue.body),
      "story-list": checkStoryList(issue.body),
      "epic-context": checkEpicContext(issue.body),
      "epic-boundary": checkEpicBoundary(issue.body),
      "epic-owner": checkEpicOwner(issue.body),
      "epic-stakeholders": checkEpicStakeholders(issue.body),
    };
  }

  // Fallback for "unknown"
  return {
    "story-format": checkStoryFormat(issue.body),
    "story-context": checkContext(issue.body),
    "epic-link": checkEpicLink(issue.body),
    "ac-presence": checkACPresence(issue.body),
    "story-links": checkStoryLinks(issue.body),
  };
}

/**
 * evaluate(result, type) – Score and Ready Gate from the criteria catalog (references/criteria/*.json).
 * Fail-closed: a criterion without a result counts as not passed.
 */
export function evaluate(result, type) {
  const spec = loadCriteria(type);
  if (!spec?.criteria) throw new Error(`No criteria found for type "${type}"`);

  let earned = 0, max = 0;
  const failed = [], missing = [], results = [];

  for (const c of spec.criteria) {
    if (c.implemented === false || !c.points) continue;
    const source = c.check === "code" ? result.deterministicChecks : result.modelChecks;
    const res = source?.[c.id];
    max += c.points;

    const entry = { id: c.id, check: c.check, points: c.points, required: !!c.required, passed: false };
    results.push(entry);

    if (!res) {                      // fail-closed: no result = not passed
      missing.push(c.id);
      failed.push({ id: c.id, required: !!c.required });
    } else if (res.passed) {
      entry.passed = true;
      earned += c.points;
    } else {
      failed.push({ id: c.id, required: !!c.required, reason: res.reason });
    }
  }

  if (missing.length && !result.modelChecks?.error) {
    console.warn(`  [criteria] no result for: ${missing.join(", ")}`);
  }

  return {
    score: max ? Math.round((earned / max) * 100) : 0,
    earned, max, failed, missing, results,
    gateFailed: failed.some((f) => f.required),
  };
}

export const calculateScore = (result, type) => evaluate(result, type).score;
export const checkReadyGate = (result, type) => evaluate(result, type).gateFailed;

/**
 * calculateStatus(score, hasFailedRequired) – Traffic-light status; the Ready Gate overrides the score.
 */
export function calculateStatus(score, hasFailedRequired = false) {
  if (hasFailedRequired) {
    return { status: "not-ready", emoji: "🔴" };
  }

  if (score >= 80) return { status: "ready", emoji: "🟢" };
  if (score >= 50) return { status: "needs-work", emoji: "🟡" };
  return { status: "not-ready", emoji: "🔴" };
}

/** Short wording for the summary line, per criterion ID. */
const SUMMARY_PHRASES = {
  "story-format": "no story format",
  "story-context": "no context (product and target group)",
  "epic-link": "no epic link",
  "ac-presence": "acceptance criteria incomplete",
  "story-links": "no story links",
  "ac-testability": "AC not testable",
  "business-value": "value unclear",
  "size-risk": "too large for one sprint",
  "goal-statement": "no goal statement",
  "benefit-statement": "no benefit statement",
  "story-list": "no child stories listed",
  "epic-goal": "epic goal unclear",
  "epic-benefit": "epic benefit unclear",
  "epic-context": "no context (product and target group)",
  "epic-boundary": "no scope boundary (in/out of scope)",
  "epic-owner": "no owner named",
  "epic-stakeholders": "no stakeholders named",
  "technical-scope": "unclear technical scope",
  "justification": "missing justification",
  "impact-analysis": "missing impact analysis",
  "rollback-plan": "missing rollback plan",
  "technical-feasibility": "technical feasibility unclear",
  "rollback-risk": "rollback risk too high",
  "reproduction-steps": "no reproduction steps",
  "expected-vs-actual": "expected vs. actual missing",
  "environment-info": "environment info missing",
  "severity": "severity not justified",
  "reproducibility": "reproducibility unclear",
};

/**
 * generateSummary(issueResult) – Short summary line, required criteria first.
 */
export function generateSummary(issueResult) {
  const { issueNumber, evaluation } = issueResult;

  if (!evaluation) {
    return `Issue #${issueNumber}: no evaluation available.`;
  }

  // Required criteria first: they decide the status.
  const failed = [...evaluation.failed].sort((a, b) => Number(b.required) - Number(a.required));

  if (failed.length === 0) {
    return `Issue #${issueNumber} is ready for refinement. All checks passed.`;
  }

  const phrases = failed.map((f) => SUMMARY_PHRASES[f.id] ?? f.id.replace(/-/g, " "));
  const firstThree = phrases.slice(0, 3).join(", ");
  const moreText = phrases.length > 3 ? ` And ${phrases.length - 3} more points.` : "";
  return `Issue #${issueNumber}: ${firstThree}.${moreText}`;
}

/**
 * processIssue(issue) – Assesses a single issue (with timing for deterministic and AI checks).
 */
export async function processIssue(issue) {
  let type = determineType(issue.labels);
  let typeInference = null;

  if (type === "unknown") {
    console.log(`  Type unknown from labels, inferring via model...`);
    typeInference = await inferType(issue);
    type = typeInference.type;
  }

  // Timing: Deterministic checks
  const detStart = performance.now();
  const detChecks = runDeterministicChecks(issue, type);
  const detDuration = performance.now() - detStart;

  // Timing: Model checks
  let modelChecks = {};
  const modelStart = performance.now();
  try {
    console.log(`  Running model checks for type: ${type}...`);
    modelChecks = await runModelChecks(issue, type);
  } catch (err) {
    console.error(`  Model checks failed: ${err.message}`);
    modelChecks = { error: { status: "failed", reason: err.message } };
  }
  const modelDuration = performance.now() - modelStart;

  const result = {
    issueNumber: issue.number,
    title: issue.title,
    body: issue.body,
    type,
    typeInference,
    deterministicChecks: detChecks,
    modelChecks,
    timings: {
      deterministic: detDuration,
      model: modelDuration,
      total: detDuration + modelDuration,
    },
    timestamp: new Date().toISOString(),
  };

  // Score, Ready Gate and status come from evaluate() (source: references/criteria/*.json)
  const evaluation = evaluate(result, type);
  result.evaluation = evaluation;
  result.score = evaluation.score;

  const statusInfo = calculateStatus(evaluation.score, evaluation.gateFailed);
  result.status = statusInfo.status;
  result.emoji = statusInfo.emoji;
  result.summary = generateSummary(result);

  return result;
}

/**
 * runPipeline() – Assesses all open issues and writes reports, summary and JSON results.
 */
export async function runPipeline() {
  console.log("Assessing issues (rules + AI checks)...\n");

  const issues = await listIssues();
  console.log(`Found ${issues.length} issues to process.\n`);

  const results = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Output directories
  const outputDir = path.join(process.cwd(), "output");
  const reportsDir = path.join(outputDir, "reports");
  mkdirSync(reportsDir, { recursive: true });

  for (const issue of issues) {
    const fullIssue = await getIssue(issue.number);
    console.log(`Processing Issue #${fullIssue.number}: "${fullIssue.title}"`);

    const result = await processIssue(fullIssue);
    results.push(result);

    const detPassed = Object.values(result.deterministicChecks).filter((c) => c.passed).length;
    const detTotal = Object.values(result.deterministicChecks).length;
    const modelStatus = result.modelChecks.error ? "error" : "ok";

    // Console output with timing
    const detTime = result.timings.deterministic.toFixed(1);
    const modelTime = (result.timings.model / 1000).toFixed(1);
    console.log(`  Deterministic: ${detPassed}/${detTotal} passed (${detTime} ms) | Model: ${modelStatus} (${modelTime} s) | Score: ${result.score}/100 ${result.emoji} ${result.status}\n`);

    // Save individual report immediately
    const markdown = generateMarkdownReport(result, result.type);
    const reportPath = path.join(reportsDir, `issue-${result.issueNumber}-report-${timestamp}.md`);
    writeFileSync(reportPath, markdown, "utf-8");
    console.log(`  → Report saved: ${reportPath}`);
  }

  // Save summary report
  const summaryMarkdown = generateSummaryReport(results, timestamp);
  const summaryPath = path.join(outputDir, `summary-${timestamp}.md`);
  writeFileSync(summaryPath, summaryMarkdown, "utf-8");
  console.log(`\n✓ Summary saved: ${summaryPath}`);

  // Save JSON results
  const jsonPath = path.join(outputDir, `results-${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`✓ Results saved: ${jsonPath}`);

  // Console summary
  const readyCount = results.filter((r) => r.status === "ready").length;
  const needsWorkCount = results.filter((r) => r.status === "needs-work").length;
  const notReadyCount = results.filter((r) => r.status === "not-ready").length;

  console.log(`\n=== Summary ===`);
  console.log(`🟢 Ready: ${readyCount}`);
  console.log(`🟡 Needs work: ${needsWorkCount}`);
  console.log(`🔴 Not ready: ${notReadyCount}`);
  console.log(`Total: ${results.length} issues`);

  return results;
}

/** Re-export from report.js for convenience. */
export { generateSummaryReport };

/** Entry point when agent.js is started directly (no improvement generation here). */
if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline().catch((error) => {
    console.error("❌ Error:", error.message);
    process.exitCode = 1;
  });
}
