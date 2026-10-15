// test/agent.test.js
//
// Unit tests for the scoring/status logic in src/agent.js: type detection, the deterministic-
// check dispatch table, score/Ready-Gate calculation (evaluate), and the traffic-light status.
// No network, no Ollama, no GitHub — these only need the criteria catalogs under references/criteria/,
// which are checked into the repo, so they run the same in CI as on any machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineType,
  runDeterministicChecks,
  evaluate,
  calculateStatus,
  generateSummary,
} from '../src/agent.js';

// ---------------------------------------------------------------------------
// determineType
// ---------------------------------------------------------------------------

test('determineType: returns "unknown" with no labels', () => {
  assert.equal(determineType([]), 'unknown');
  assert.equal(determineType(undefined), 'unknown');
  assert.equal(determineType('not-an-array'), 'unknown');
});

test('determineType: reads the type from the type:* label', () => {
  assert.equal(determineType([{ name: 'type:story' }]), 'story');
  assert.equal(determineType([{ name: 'type:task' }]), 'task');
  assert.equal(determineType([{ name: 'type:bug' }]), 'bug');
  assert.equal(determineType([{ name: 'type:epic' }]), 'epic');
});

test('determineType: label matching is case-insensitive', () => {
  assert.equal(determineType([{ name: 'Type:Story' }]), 'story');
});

test('determineType: ignores unrelated labels and falls back to "unknown"', () => {
  assert.equal(determineType([{ name: 'demo-seed' }, { name: 'priority:high' }]), 'unknown');
});

// ---------------------------------------------------------------------------
// runDeterministicChecks: the right checks run for the right type
// ---------------------------------------------------------------------------

test('runDeterministicChecks: dispatches the 5 story checks for type "story"', () => {
  const result = runDeterministicChecks({ body: '' }, 'story');
  assert.deepEqual(
    Object.keys(result).sort(),
    ['ac-presence', 'epic-link', 'story-context', 'story-format', 'story-links'].sort()
  );
});

test('runDeterministicChecks: dispatches the 5 task checks for type "task"', () => {
  const result = runDeterministicChecks({ body: '' }, 'task');
  assert.deepEqual(
    Object.keys(result).sort(),
    ['ac-presence', 'impact-analysis', 'justification', 'rollback-plan', 'technical-scope'].sort()
  );
});

test('runDeterministicChecks: dispatches the 4 bug checks for type "bug"', () => {
  const result = runDeterministicChecks({ body: '' }, 'bug');
  assert.deepEqual(
    Object.keys(result).sort(),
    ['ac-presence', 'environment-info', 'expected-vs-actual', 'reproduction-steps'].sort()
  );
});

test('runDeterministicChecks: dispatches the 3 epic checks for type "epic"', () => {
  const result = runDeterministicChecks({ body: '' }, 'epic');
  assert.deepEqual(
    Object.keys(result).sort(),
    ['benefit-statement', 'goal-statement', 'story-list'].sort()
  );
});

test('runDeterministicChecks: falls back to the story checks for an unknown type', () => {
  const result = runDeterministicChecks({ body: '' }, 'unknown');
  assert.deepEqual(
    Object.keys(result).sort(),
    ['ac-presence', 'epic-link', 'story-context', 'story-format', 'story-links'].sort()
  );
});

// ---------------------------------------------------------------------------
// calculateStatus: the Ready Gate overrides the score
// ---------------------------------------------------------------------------

test('calculateStatus: score >= 80 is "ready" (🟢)', () => {
  assert.deepEqual(calculateStatus(80, false), { status: 'ready', emoji: '🟢' });
  assert.deepEqual(calculateStatus(100, false), { status: 'ready', emoji: '🟢' });
});

test('calculateStatus: 50 <= score < 80 is "needs-work" (🟡)', () => {
  assert.deepEqual(calculateStatus(79, false), { status: 'needs-work', emoji: '🟡' });
  assert.deepEqual(calculateStatus(50, false), { status: 'needs-work', emoji: '🟡' });
});

test('calculateStatus: score < 50 is "not-ready" (🔴)', () => {
  assert.deepEqual(calculateStatus(49, false), { status: 'not-ready', emoji: '🔴' });
  assert.deepEqual(calculateStatus(0, false), { status: 'not-ready', emoji: '🔴' });
});

test('calculateStatus: a failed required criterion forces "not-ready" regardless of score', () => {
  // This is the case behind #4 and #11 in the demo backlog: 80 and 90 points, but 🔴.
  assert.deepEqual(calculateStatus(90, true), { status: 'not-ready', emoji: '🔴' });
  assert.deepEqual(calculateStatus(100, true), { status: 'not-ready', emoji: '🔴' });
});

// ---------------------------------------------------------------------------
// evaluate: fail-closed scoring against the real criteria catalogs
// ---------------------------------------------------------------------------
// Story criteria (references/criteria/story-check-criteria.json): 5 code checks worth 10 points
// each (50 total) and 3 model checks — ac-testability (17, required), business-value (16),
// size-risk (17) — worth 50 total. "independence" is implemented: false and carries no points.

const allStoryChecksPassed = {
  'story-format': { passed: true },
  'story-context': { passed: true },
  'epic-link': { passed: true },
  'ac-presence': { passed: true },
  'story-links': { passed: true },
};

test('evaluate: fail-closed — a required model criterion with no result counts as failed', () => {
  // No modelChecks at all (e.g. the model step was skipped or crashed): ac-testability has no
  // result, so by design it is NOT given the benefit of the doubt.
  const result = evaluate({ deterministicChecks: allStoryChecksPassed, modelChecks: undefined }, 'story');
  assert.equal(result.gateFailed, true);
  assert.equal(result.earned, 50); // only the 5 code checks (10 pts each)
  assert.equal(result.score, 50); // 50 / 100
  assert.ok(result.missing.includes('ac-testability'));
});

test('evaluate: a fully passing story scores 100 and the gate does not fail', () => {
  const modelChecks = {
    'ac-testability': { passed: true },
    'business-value': { passed: true },
    'size-risk': { passed: true },
  };
  const result = evaluate({ deterministicChecks: allStoryChecksPassed, modelChecks }, 'story');
  assert.equal(result.score, 100);
  assert.equal(result.gateFailed, false);
});

test('evaluate: a failed non-required check lowers the score but does not fail the gate', () => {
  // epic-link and story-links are not required (per the catalog); failing only them should
  // cost points without tripping the Ready Gate.
  const deterministicChecks = {
    ...allStoryChecksPassed,
    'epic-link': { passed: false, reason: 'no reference' },
    'story-links': { passed: false, reason: 'no links' },
  };
  const modelChecks = {
    'ac-testability': { passed: true },
    'business-value': { passed: true },
    'size-risk': { passed: true },
  };
  const result = evaluate({ deterministicChecks, modelChecks }, 'story');
  assert.equal(result.gateFailed, false);
  assert.equal(result.score, 80); // lost 10 + 10 of 100
});

// ---------------------------------------------------------------------------
// generateSummary
// ---------------------------------------------------------------------------

test('generateSummary: reports "ready for refinement" when nothing failed', () => {
  const summary = generateSummary({ issueNumber: 7, evaluation: { failed: [] } });
  assert.match(summary, /Issue #7 is ready for refinement/);
});

test('generateSummary: lists required failures before optional ones', () => {
  const evaluation = {
    failed: [
      { id: 'story-links', required: false },
      { id: 'story-format', required: true },
    ],
  };
  const summary = generateSummary({ issueNumber: 3, evaluation });
  const formatIndex = summary.indexOf('no story format');
  const linksIndex = summary.indexOf('no story links');
  assert.ok(formatIndex !== -1 && linksIndex !== -1 && formatIndex < linksIndex);
});

test('generateSummary: only shows the first 3 reasons and counts the rest', () => {
  const evaluation = {
    failed: [
      { id: 'story-format', required: true },
      { id: 'story-context', required: true },
      { id: 'epic-link', required: false },
      { id: 'ac-presence', required: true },
      { id: 'story-links', required: false },
    ],
  };
  const summary = generateSummary({ issueNumber: 5, evaluation });
  assert.match(summary, /And 2 more points\./);
});
