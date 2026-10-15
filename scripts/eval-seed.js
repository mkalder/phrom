// scripts/eval-seed.js
//
// Test-set evaluation: runs the seed issues through Phrom offline (from seed/issues.json, not from
// GitHub) and compares the gaps found with `expected.findings`.
//
//   node scripts/eval-seed.js                 deterministic checks only (fast, reproducible)
//   node scripts/eval-seed.js --ai            full pipeline incl. AI checks (Ollama, several minutes)
//   node scripts/eval-seed.js --file=path     other seed file
//   node scripts/eval-seed.js --json          also write output/eval-seed-<time>.json
//
// Reading: "missed" = expected gap not found, "extra" = Phrom reports a gap the seed does not expect
// (for control cases: a false positive).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const useAI = args.includes('--ai');
const writeJson = args.includes('--json');
const file = args.find((a) => a.startsWith('--file='))?.split('=')[1] ?? 'seed/issues.json';

const { determineType, runDeterministicChecks, processIssue } = await import('../src/agent.js');

// ---------------------------------------------------------------------------
// Seed IDs (criteria specification) → implementation keys
// ---------------------------------------------------------------------------

const SPEC_TO_KEY = {
    story: {
        'story-format': 'story-format',
        'story-context': 'story-context',
        context: 'story-context',          // legacy seed ID
        'epic-link': 'epic-link',
        'ac-presence': 'ac-presence',
        'business-value': 'business-value',
        value: 'business-value',           // legacy seed ID
        'ac-testability': 'ac-testability',
        'size-risk': 'size-risk',
    },
    // The epic specification is finer than the implementation: goal and benefit each have a formal
    // (rule) and a content (AI) check; "slicing" corresponds to the story list.
    epic: {
        'epic-goal': ['goal-statement', 'epic-goal'],
        'epic-benefit': ['benefit-statement', 'epic-benefit'],
        'epic-slicing': 'story-list',
        'epic-oversize-risk': 'size-risk',
        'size-risk': 'size-risk',
    },
};

// Task and bug: expected findings use the implementation's criterion IDs directly.
const identity = (keys) => Object.fromEntries(keys.map((k) => [k, k]));
SPEC_TO_KEY.task = identity([
    'technical-scope', 'justification', 'impact-analysis', 'rollback-plan', 'ac-presence',
    'ac-testability', 'size-risk', 'technical-feasibility', 'rollback-risk',
]);
SPEC_TO_KEY.bug = identity([
    'reproduction-steps', 'expected-vs-actual', 'environment-info', 'ac-presence',
    'ac-testability', 'size-risk', 'severity', 'reproducibility',
]);

const toKeys = (value) => (Array.isArray(value) ? value : [value]);

const AI_KEYS = new Set([
    'ac-testability', 'size-risk', 'business-value', 'epic-goal', 'epic-benefit',
    'technical-feasibility', 'rollback-risk', 'severity', 'reproducibility',
]);

const SKIPPED_NOTES = new Set(['out-of-scope']);

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

const seeds = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));

// seedId = position in the test set, not a GitHub issue number
const seedIdOf = (seed) => seed.seedId ?? seed.number;

const asIssue = (seed) => ({
    number: seedIdOf(seed),
    title: seed.title,
    body: seed.body,
    labels: seed.labels.map((name) => ({ name })),
});

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

const rows = [];
const perCriterion = new Map(); // key -> { expected, hit, extra }
const bump = (key, field) => {
    const entry = perCriterion.get(key) ?? { expected: 0, hit: 0, extra: 0 };
    entry[field] += 1;
    perCriterion.set(key, entry);
};

for (const seed of seeds) {
    const issue = asIssue(seed);
    const type = determineType(issue.labels);
    const skipped = SKIPPED_NOTES.has(seed.expected?.note) || !SPEC_TO_KEY[type];

    if (skipped) {
        rows.push({ number: seedIdOf(seed), title: seed.title, type, note: seed.expected?.note, skipped: true });
        continue;
    }

    // Translate expectations into implementation keys; unimplemented specification IDs are listed separately.
    const map = SPEC_TO_KEY[type];
    const expectedSpecs = [];
    const unsupported = [];
    for (const spec of seed.expected.findings) {
        if (map[spec]) expectedSpecs.push({ spec, keys: toKeys(map[spec]) });
        else unsupported.push(spec);
    }
    const covered = new Set(expectedSpecs.flatMap((e) => e.keys));

    // Actual findings
    let produced;
    let score = null;
    let status = null;

    if (useAI) {
        const result = await processIssue(issue);
        produced = result.evaluation.failed.map((f) => f.id);
        score = result.score;
        status = result.status;
    } else {
        const det = runDeterministicChecks(issue, type);
        produced = Object.entries(det).filter(([, r]) => !r.passed).map(([key]) => key);
    }

    // Without --ai, purely AI-based criteria cannot be checked
    const comparable = expectedSpecs.filter((e) => useAI || e.keys.some((k) => !AI_KEYS.has(k)));
    const notChecked = expectedSpecs.filter((e) => !comparable.includes(e)).map((e) => e.spec);

    const isHit = (e) => e.keys.some((k) => produced.includes(k));
    const hit = comparable.filter(isHit).map((e) => e.spec);
    const missed = comparable.filter((e) => !isHit(e)).map((e) => e.spec);
    const extra = produced.filter((k) => !covered.has(k));
    const expected = comparable.map((e) => e.spec);

    expected.forEach((k) => bump(k, 'expected'));
    hit.forEach((k) => bump(k, 'hit'));
    extra.forEach((k) => bump(k, 'extra'));

    rows.push({
        number: seedIdOf(seed), title: seed.title, type, note: seed.expected.note,
        expected, hit, missed, extra, notChecked, unsupported, score, status,
    });
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

const mode = useAI ? 'full pipeline (rules + AI)' : 'deterministic checks only';
console.log(`\nSeed evaluation · ${mode} · ${seeds.length} issues\n`);

for (const r of rows) {
    const head = `#${String(r.number).padStart(2)} ${r.type.padEnd(5)} ${r.title}`;
    if (r.skipped) {
        console.log(`  –  ${head}  (skipped: ${r.note ?? 'unsupported type'})`);
        continue;
    }
    const ok = r.missed.length === 0 && r.extra.length === 0;
    const extraInfo = useAI ? `  [${r.score}/100 ${r.status}]` : '';
    console.log(`  ${ok ? '✔' : '✖'}  ${head}  (${r.note})${extraInfo}`);
    if (r.missed.length) console.log(`       missed:     ${r.missed.join(', ')}  ← expected, not found`);
    if (r.extra.length) console.log(`       extra:      ${r.extra.join(', ')}  ← found, not expected`);
    if (r.notChecked.length) console.log(`       AI, not checked:   ${r.notChecked.join(', ')}`);
    if (r.unsupported.length) console.log(`       not implemented:   ${r.unsupported.join(', ')}`);
}

const evaluated = rows.filter((r) => !r.skipped);
const exact = evaluated.filter((r) => r.missed.length === 0 && r.extra.length === 0).length;
const totalExpected = evaluated.reduce((n, r) => n + r.expected.length, 0);
const totalHit = evaluated.reduce((n, r) => n + r.hit.length, 0);
const totalExtra = evaluated.reduce((n, r) => n + r.extra.length, 0);

console.log(`\nIssues exactly as expected: ${exact}/${evaluated.length}`);
console.log(`Expected gaps found:        ${totalHit}/${totalExpected}`);
console.log(`Additional findings:        ${totalExtra}\n`);

console.log('Per criterion (expected / found / extra):');
for (const [key, v] of [...perCriterion.entries()].sort()) {
    console.log(`  ${key.padEnd(18)} ${String(v.expected).padStart(2)} / ${String(v.hit).padStart(2)} / ${String(v.extra).padStart(2)}`);
}
console.log();

// CI gate: an expected gap not found is always a regression. An unexpected extra finding is only
// a regression without --ai: the AI path can legitimately surface findings the seed did not
// anticipate (see evidenz-2026-10-08.md, category A/B); the deterministic path should match exactly.
const hasMissed = evaluated.some((r) => r.missed.length > 0);
const hasUnexpectedExtra = !useAI && evaluated.some((r) => r.extra.length > 0);
if (hasMissed || hasUnexpectedExtra) {
    console.log(
        useAI
            ? 'Regression: at least one expected gap was not found.\n'
            : 'Regression: deterministic checks no longer match the seed expectations exactly.\n'
    );
    process.exitCode = 1;
}

if (writeJson) {
    fs.mkdirSync('output', { recursive: true });
    const out = path.join('output', `eval-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify({ mode, rows, perCriterion: Object.fromEntries(perCriterion) }, null, 2));
    console.log(`JSON saved: ${out}`);
}
