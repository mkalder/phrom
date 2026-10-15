// test/checks.test.js
//
// Unit tests for the deterministic (rule-based, no AI) checks in src/checks.js.
// These functions are pure: same input, same output, no network, no Ollama — ideal for CI.
//
// Two tests below (marked "Regression:") pin down known weaknesses documented in
// audit/release-fixes/discovery/evidenz-2026-10-08.md (P-6, P-7). They describe the CURRENT
// behavior, not the desired one — if a fix changes that behavior on purpose, update the test
// and the evidence doc together, don't just delete the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStoryFormat,
  checkContext,
  checkEpicLink,
  checkACPresence,
  checkStoryLinks,
  checkTechnicalScope,
  checkJustification,
  checkImpactAnalysis,
  checkRollbackPlan,
  checkReproductionSteps,
  checkExpectedVsActual,
  checkEnvironmentInfo,
  checkGoalStatement,
  checkBenefitStatement,
  checkStoryList,
} from '../src/checks.js';

// ---------------------------------------------------------------------------
// checkStoryFormat
// ---------------------------------------------------------------------------

test('checkStoryFormat: fails on empty body', () => {
  assert.equal(checkStoryFormat('').passed, false);
  assert.equal(checkStoryFormat(undefined).passed, false);
});

test('checkStoryFormat: fails on a one-sentence story with no role/want/why', () => {
  assert.equal(checkStoryFormat('The login should be better.').passed, false);
});

test('checkStoryFormat: passes on the standard "As a ... I want ... so that ..." pattern', () => {
  const body = 'As a customer, I want to download my invoice so that I have it for my records.';
  assert.equal(checkStoryFormat(body).passed, true);
});

test('checkStoryFormat: passes on the German pattern', () => {
  const body = 'Als Kunde möchte ich meine Rechnung herunterladen damit ich sie archivieren kann.';
  assert.equal(checkStoryFormat(body).passed, true);
});

// ---------------------------------------------------------------------------
// checkContext
// ---------------------------------------------------------------------------

test('checkContext: fails when neither product nor target group is named', () => {
  const result = checkContext('As a customer, I want this so that benefit.');
  assert.equal(result.passed, false);
  assert.match(result.reason, /product/);
});

test('checkContext: passes when product and target group are both named', () => {
  const body = 'Context: Customer Portal, residential customers.\n\nAs a customer, I want this so that benefit.';
  const result = checkContext(body);
  assert.equal(result.passed, true);
  assert.match(result.evidence, /Product:/);
});

// ---------------------------------------------------------------------------
// checkEpicLink
// ---------------------------------------------------------------------------

test('checkEpicLink: fails when no issue reference is present', () => {
  assert.equal(checkEpicLink('No references here.').passed, false);
});

test('checkEpicLink: passes on a single reference (treated as the likely parent epic)', () => {
  const result = checkEpicLink('See #3 for background.');
  assert.equal(result.passed, true);
});

test('checkEpicLink: fails on multiple references without epic context', () => {
  const result = checkEpicLink('See #3 and #7 for background.');
  assert.equal(result.passed, false);
  assert.match(result.reason, /Multiple issue references/);
});

test('checkEpicLink: passes on multiple references when epic context is stated', () => {
  const result = checkEpicLink('Part of epic #3. Also related to #7.');
  assert.equal(result.passed, true);
});

// ---------------------------------------------------------------------------
// checkACPresence
// ---------------------------------------------------------------------------

test('checkACPresence: fails with no acceptance criteria at all', () => {
  assert.equal(checkACPresence('Just a description, no criteria.').passed, false);
});

test('checkACPresence: fails with only one criterion (needs happy path + a negative case)', () => {
  const body = '- [ ] Given a valid invoice, when the user clicks download, then the PDF opens.';
  const result = checkACPresence(body);
  assert.equal(result.passed, false);
  assert.match(result.reason, /at least 2/);
});

test('checkACPresence: passes with a happy-path and a negative/error case', () => {
  const body = [
    '- [ ] Given a valid invoice, when the user clicks download, then the PDF opens.',
    '- [ ] Given an expired session, when the user clicks download, then an error is shown.',
  ].join('\n');
  assert.equal(checkACPresence(body).passed, true);
});

// ---------------------------------------------------------------------------
// checkStoryLinks (optional — a non-empty body always passes)
// ---------------------------------------------------------------------------

test('checkStoryLinks: passes even with no links (optional criterion)', () => {
  assert.equal(checkStoryLinks('As a customer, I want this.').passed, true);
});

test('checkStoryLinks: passes and reports links when present', () => {
  const result = checkStoryLinks('Depends on #4. Blocks #9.');
  assert.equal(result.passed, true);
  assert.match(result.evidence, /depends/);
});

// ---------------------------------------------------------------------------
// checkTechnicalScope
// ---------------------------------------------------------------------------

test('checkTechnicalScope: fails with no scope section and no action items', () => {
  assert.equal(checkTechnicalScope('Update the database.').passed, false);
});

test('checkTechnicalScope: passes with a scope section and at least 2 bulleted action items', () => {
  const body = [
    '## Scope',
    '- Migrate the schema to PostgreSQL 18',
    '- Update the connection pool configuration',
  ].join('\n');
  assert.equal(checkTechnicalScope(body).passed, true);
});

test('Regression (P-7): a bold label line like "**Task:** ..." is miscounted as a bulleted action item', () => {
  // The implementation treats any line starting with "*" as a list item — a bold label such as
  // "**Task:** ..." also starts with "*", so with only ONE real bullet it still reaches the
  // >=2-action-items threshold by miscounting the label line as a second item.
  // This test documents the current behavior; see evidenz-2026-10-08.md, P-7 (reports #13, #15).
  const body = [
    '## Scope',
    '- Migrate the schema to PostgreSQL 18',
    '**Task:** update the connection string afterward',
  ].join('\n');
  const result = checkTechnicalScope(body);
  assert.equal(result.passed, true);
  assert.match(result.evidence, /2 technical work items/);
});

// ---------------------------------------------------------------------------
// checkJustification
// ---------------------------------------------------------------------------

test('checkJustification: fails with no "why" section and no driver keyword', () => {
  assert.equal(checkJustification('We will migrate the database.').passed, false);
});

test('checkJustification: fails when a "why" section exists but names no concrete driver', () => {
  const result = checkJustification('## Why\nIt is time to do this.');
  assert.equal(result.passed, false);
  assert.match(result.reason, /lacks concrete driver/);
});

test('checkJustification: passes when a concrete driver (EOL, security, ...) is named', () => {
  const result = checkJustification('## Why\nPostgreSQL 16 reaches EOL in Q4 2026.');
  assert.equal(result.passed, true);
});

// ---------------------------------------------------------------------------
// checkImpactAnalysis
// ---------------------------------------------------------------------------

test('checkImpactAnalysis: fails with no impact-related wording at all', () => {
  assert.equal(checkImpactAnalysis('We will migrate the database.').passed, false);
});

test('Regression (P-6): the word "rollback" alone is enough to detect an "impact" section', () => {
  // impactPatterns matches the bare word "rollback" even without an actual Impact/Affected/
  // Downtime/Risks section. With no other impact element present, the function still reports
  // "section exists but incomplete" — which reads as contradictory when nothing was found.
  // See evidenz-2026-10-08.md, P-6 (report #15).
  const result = checkImpactAnalysis('We have a rollback plan ready.');
  assert.equal(result.passed, false);
  assert.match(result.reason, /Impact section exists but incomplete/);
});

test('checkImpactAnalysis: passes with at least 2 of affected systems / downtime / risks', () => {
  const body = '## Impact\nAffected systems: billing-service. Planned downtime: 30 minutes.';
  assert.equal(checkImpactAnalysis(body).passed, true);
});

// ---------------------------------------------------------------------------
// checkRollbackPlan
// ---------------------------------------------------------------------------

test('checkRollbackPlan: fails with no rollback section', () => {
  assert.equal(checkRollbackPlan('We will migrate the database.').passed, false);
});

test('checkRollbackPlan: fails when the section exists but lacks detail', () => {
  const result = checkRollbackPlan('## Rollback Plan\nWe can roll back.');
  assert.equal(result.passed, false);
});

test('checkRollbackPlan: passes with at least 2 concrete details', () => {
  const body = '## Rollback Plan\nRestore from backup, tested in staging, takes about 15 minutes.';
  assert.equal(checkRollbackPlan(body).passed, true);
});

// ---------------------------------------------------------------------------
// checkReproductionSteps
// ---------------------------------------------------------------------------

test('checkReproductionSteps: fails with fewer than 2 numbered steps', () => {
  assert.equal(checkReproductionSteps('1. Open the app.').passed, false);
});

test('checkReproductionSteps: passes with at least 2 numbered steps', () => {
  const body = '1. Open the app.\n2. Click download.\n3. Observe the error.';
  assert.equal(checkReproductionSteps(body).passed, true);
});

// ---------------------------------------------------------------------------
// checkExpectedVsActual
// ---------------------------------------------------------------------------

test('checkExpectedVsActual: fails when only "expected" or only "actual" is present', () => {
  assert.equal(checkExpectedVsActual('Expected: the PDF downloads.').passed, false);
});

test('checkExpectedVsActual: passes when both expected and actual behavior are described', () => {
  const body = 'Expected: the PDF downloads.\nActual: a 500 error is shown instead.';
  assert.equal(checkExpectedVsActual(body).passed, true);
});

// ---------------------------------------------------------------------------
// checkEnvironmentInfo
// ---------------------------------------------------------------------------

test('checkEnvironmentInfo: fails with fewer than 2 details', () => {
  assert.equal(checkEnvironmentInfo('Happens on mobile.').passed, false);
});

test('checkEnvironmentInfo: passes with at least 2 details (e.g. browser + OS/version)', () => {
  assert.equal(checkEnvironmentInfo('Safari on iOS 16.').passed, true);
});

// ---------------------------------------------------------------------------
// checkGoalStatement / checkBenefitStatement / checkStoryList (epic checks)
// ---------------------------------------------------------------------------

test('checkGoalStatement: fails with no goal section', () => {
  assert.equal(checkGoalStatement('Modernize the portal.').passed, false);
});

test('checkGoalStatement: passes with a goal section of reasonable length', () => {
  const body = '## Goal\nCustomers can self-serve invoices without contacting support.';
  assert.equal(checkGoalStatement(body).passed, true);
});

test('checkBenefitStatement: fails with no benefit section', () => {
  assert.equal(checkBenefitStatement('Modernize the portal.').passed, false);
});

test('checkBenefitStatement: passes with a benefit section of reasonable length', () => {
  const body = '## Benefit\nSupport reduces ticket volume by handling fewer invoice requests.';
  assert.equal(checkBenefitStatement(body).passed, true);
});

test('checkStoryList: fails with fewer than 2 child-story references', () => {
  assert.equal(checkStoryList('No child stories yet.').passed, false);
});

test('checkStoryList: passes with at least 2 child-story references', () => {
  assert.equal(checkStoryList('Child stories: #4, #5, #6.').passed, true);
});
