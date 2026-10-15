// test/model-improve.test.js
//
// Unit tests for sanitizeDraft() in src/model-improve.js — the safety net that is supposed to
// strip invented issue numbers, percentages, dates and quarters from a generated draft. It does
// NOT catch every kind of invented or reference-copied detail (see evidenz-2026-10-08.md,
// section "Testschwachstellen" / the reference-leakage findings for #11 and #14) — these tests
// cover only what the function is actually designed to do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDraft } from '../src/model-improve.js';

test('sanitizeDraft: replaces an issue reference that is NOT in the original text', () => {
  const { text, replaced } = sanitizeDraft('See #42 for context.', 'The original issue body.');
  assert.equal(text, 'See #[number] for context.');
  assert.equal(replaced, 1);
});

test('sanitizeDraft: keeps an issue reference that IS present in the original text', () => {
  const original = 'Part of epic #3.';
  const { text, replaced } = sanitizeDraft('Part of epic #3.', original);
  assert.equal(text, 'Part of epic #3.');
  assert.equal(replaced, 0);
});

test('sanitizeDraft: replaces an invented percentage', () => {
  const { text, replaced } = sanitizeDraft('This reduces load by 75%.', 'No numbers here.');
  assert.equal(text, 'This reduces load by [x]%.');
  assert.equal(replaced, 1);
});

test('sanitizeDraft: keeps a percentage that is present in the original text', () => {
  const original = 'Current error rate is 25%.';
  const { text } = sanitizeDraft('Current error rate is 25%.', original);
  assert.equal(text, 'Current error rate is 25%.');
});

test('sanitizeDraft: replaces an invented ISO date', () => {
  const { text, replaced } = sanitizeDraft('Deadline: 2026-12-01.', 'No date mentioned.');
  assert.equal(text, 'Deadline: [date].');
  assert.equal(replaced, 1);
});

test('sanitizeDraft: replaces an invented quarter reference', () => {
  const { text, replaced } = sanitizeDraft('Ships in Q3.', 'No timeline given.');
  assert.equal(text, 'Ships in [quarter].');
  assert.equal(replaced, 1);
});

test('sanitizeDraft: handles multiple invented details in one draft and counts them all', () => {
  const draft = 'Fixes #99, cuts errors by 80% before 2026-01-01 (Q1).';
  const { text, replaced } = sanitizeDraft(draft, 'The original mentions none of this.');
  assert.equal(text, 'Fixes #[number], cuts errors by [x]% before [date] ([quarter]).');
  assert.equal(replaced, 4);
});

test('sanitizeDraft: leaves prose untouched when nothing matches the known patterns', () => {
  const { text, replaced } = sanitizeDraft('A plain sentence with no numbers.', '');
  assert.equal(text, 'A plain sentence with no numbers.');
  assert.equal(replaced, 0);
});
