// scripts/demo.js
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { printBanner } from './banner.js';
import { LITELLM_HOST, MODEL_NAME, describeAiEndpoint } from '../src/llm-client.js';

const execAsync = promisify(exec);

// Files older than the start of this run are treated as stale.
const startedAtWall = Date.now() - 2000;

// Flags: --verbose (full preflight), --full (show placeholder sections), --showcase=<n>
const verbose = process.argv.includes('--verbose');
const showFull = process.argv.includes('--full');
const showcaseArg = process.argv.find((arg) => arg.startsWith('--showcase='));
const forcedShowcase = Number(showcaseArg?.split('=')[1]) || null;

// ============================================================================
// UI HELPERS
// ============================================================================

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));

const bold = ansi(1);
const dim = ansi(2);
const red = ansi(31);
const green = ansi(32);
const yellow = ansi(33);

const SYMBOL = { ok: green('✔'), fail: red('✖'), warn: yellow('▲') };
const DOT = { ready: green('●'), needsWork: yellow('●'), notReady: red('●'), unknown: dim('●') };

const STATUS = {
    ready: { dot: DOT.ready, text: 'Ready' },
    'needs-work': { dot: DOT.needsWork, text: 'Needs work' },
    'not-ready': { dot: DOT.notReady, text: 'Not ready' },
};

const RULE = dim('─'.repeat(44));
const TEXT_WIDTH = 76;

const section = (title, hint = '') =>
    console.log(`\n${bold(title)}${hint ? dim(`  ${hint}`) : ''}\n`);
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const firstLine = (text = '') => String(text).split('\n')[0];

const fmtDuration = (ms) =>
    ms < 1000 ? '<1 s' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

/** Maps technical errors to a short, human-readable reason. */
function explainError(error) {
    const text = String(error?.stderr ?? '') + String(error?.stdout ?? '') + String(error?.message ?? '');
    if (/\b410\b/.test(text)) return 'issue no longer exists (410 Gone)';
    if (/\b404\b/.test(text)) return 'issue not found (404)';
    if (/\b(401|403)\b/.test(text)) return 'GitHub access denied (401/403)';
    if (/ECONNREFUSED|fetch failed/i.test(text)) return 'service not reachable';
    const line = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('Command failed') && !l.startsWith('>'));
    return truncate(line ?? 'unknown error', 70);
}

/** Animated spinner for async work. Silent when stdout is not a TTY. */
async function withSpinner(label, fn) {
    if (!process.stdout.isTTY) return fn();

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const timer = setInterval(() => {
        process.stdout.write(`\r\x1b[2K  ${dim(frames[i++ % frames.length])} ${label}`);
    }, 80);

    try {
        return await fn();
    } finally {
        clearInterval(timer);
        process.stdout.write('\r\x1b[2K');
    }
}

/** Word-wrap a single line with hanging indent for list items. */
function wrapLine(line, width) {
    const lead = (line.match(/^\s*(?:[-*•☐☑]\s+|\d+\.\s+)?/) || [''])[0];
    const pad = ' '.repeat(lead.length);
    const words = line.slice(lead.length).split(/\s+/).filter(Boolean);

    if (words.length === 0) return [''];

    const out = [];
    let current = lead;
    let empty = true;

    for (const word of words) {
        const candidate = empty ? current + word : `${current} ${word}`;
        if (candidate.length > width && !empty) {
            out.push(current);
            current = pad + word;
        } else {
            current = candidate;
        }
        empty = false;
    }
    out.push(current);
    return out;
}

/** Light markdown → terminal rendering (headings/labels bold, checkboxes as ☐). */
function renderMarkdown(text, width = TEXT_WIDTH - 2) {
    return text.split('\n').flatMap((raw) => {
        const heading = raw.match(/^#{1,6}\s+(.*)$/);
        if (heading) return [bold(heading[1].replace(/\*\*/g, ''))];

        const label = raw.match(/^\*\*(.+?)\*\*\s*$/);
        if (label) return [bold(label[1])];

        const line = raw
            .replace(/^(\s*)[-*]\s+\[ \]\s+/, '$1☐ ')
            .replace(/^(\s*)[-*]\s+\[[xX]\]\s+/, '$1☑ ')
            .replace(/\*\*/g, '')
            .replace(/`/g, '');

        return wrapLine(line, width);
    });
}

function printBlock(label, lines, note = '') {
    console.log(`  ${bold(label)}${note ? dim(`  ${note}`) : ''}`);
    console.log(`  ${dim('─'.repeat(40))}`);
    lines.forEach((line) => console.log(`  ${line}`));
    console.log();
}

const run = async (command) => {
    const { stdout } = await execAsync(command, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60_000,
    });
    return stdout;
};

// ============================================================================
// FILE HELPERS
// ============================================================================

const REPORT_DIR = path.resolve('output/reports');
const DRAFT_DIR = path.resolve('output/improvement-suggestions');

const relPath = (filePath) => path.relative(process.cwd(), filePath);
const readIfExists = (filePath) => (filePath ? fs.readFileSync(filePath, 'utf-8') : '');

/** Newest .md file in `dir` for the issue (e.g. "issue-3-…"), optionally only if modified after `since`. */
function latestFileForIssue(dir, issueNumber, { include, since = 0 } = {}) {
    if (!fs.existsSync(dir)) return null;

    const issueRe = new RegExp(`issue[-_ ]?${issueNumber}(?!\\d)`, 'i');

    const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md') && issueRe.test(f) && (!include || include.test(f)))
        .map((f) => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .filter((f) => f.mtime >= since)
        .sort((a, b) => b.mtime - a.mtime);

    return files.length ? path.join(dir, files[0].file) : null;
}

// ============================================================================
// PARSING (CLI output and Phrom markdown output)
// ============================================================================

/** "#3: Improve login [type:story, bug]" → { number, title, labels } */
function parseIssueList(output) {
    return [...output.matchAll(/^#(\d+):\s+(.*)\s+\[([^\]]*)\]\s*$/gm)].map((m) => ({
        number: Number(m[1]),
        title: m[2].trim(),
        labels: m[3].split(',').map((l) => l.trim().toLowerCase()),
    }));
}

/** "🔴 #3: Improve login – 10/50 (det: 1/5)" → Map(number → { score out of 50, passed, total }) */
function parseFormalScores(output) {
    const scores = new Map();
    for (const m of output.matchAll(/^(?:🟢|🟡|🔴)\s+#(\d+):.*\s[–-]\s(\d+)\/50\s+\(det:\s*(\d+)\/(\d+)\)/gm)) {
        scores.set(Number(m[1]), { score: Number(m[2]), passed: Number(m[3]), total: Number(m[4]) });
    }
    return scores;
}

function extractScore(text) {
    const match = text.match(/(\d{1,3})\s*\/\s*100/);
    if (!match) return null;
    const value = Number(match[1]);
    return value <= 100 ? value : null;
}

/** "**Current Status:** Not-ready" or "Score: 27/100 – not-ready" → "Not-ready" */
function extractStatus(text) {
    const labelled = text.match(/status:?\**\s*(not[-\s]?ready|needs[-\s]?work|ready)\b/i);
    if (labelled) return labelled[1];
    const inline = text.match(/\/\s*100\s*[–-]\s*(not[-\s]?ready|needs[-\s]?work|ready)\b/i);
    return inline ? inline[1] : null;
}

function normalizeStatus(raw) {
    if (!raw) return null;
    return STATUS[raw.toLowerCase().replace(/[\s_]+/g, '-')] ?? null;
}

/** Score + status from the best available source; never invented. */
function resolveAssessment(number, selectOutput) {
    const texts = [
        selectOutput,
        readIfExists(latestFileForIssue(REPORT_DIR, number, { since: startedAtWall })),
        readIfExists(latestFileForIssue(DRAFT_DIR, number, { include: /improvement/i, since: startedAtWall })),
    ];

    let score = null;
    let status = null;
    for (const text of texts) {
        if (!text) continue;
        score ??= extractScore(text);
        status ??= normalizeStatus(extractStatus(text));
    }
    return { score, status };
}

/** "Ac-testability" → "AC testability" */
function humanizeCriterion(raw) {
    const text = raw
        .replace(/\*\*|`/g, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\bac\b/gi, 'AC')
        .replace(/\s+/g, ' ')
        .trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/**
 * Parses "### 1. Story-format (deterministic)" blocks from the detailed suggestions
 * and their "**Problem:** …" line. Returns [] if the structure is not found.
 */
function parseFindings(markdown) {
    const headingRe = /^###\s+\d+\.\s+(.+?)\s+\((deterministic|ai)\)\s*$/i;
    const findings = [];
    let current = null;

    for (const line of markdown.split('\n')) {
        const heading = line.match(headingRe);
        if (heading) {
            current = { name: humanizeCriterion(heading[1]), kind: heading[2].toLowerCase(), problem: '' };
            findings.push(current);
            continue;
        }
        if (/^##\s/.test(line)) {
            current = null;
            continue;
        }
        const problem = current && line.match(/^\*\*Problem:\*\*\s*(.+)$/);
        if (problem) current.problem = problem[1].trim();
    }
    return findings;
}

/** Content of "## 📝 Revised Issue Draft" up to "## 🎯 Next Steps", without intro sentence and separators. */
function extractRevisedDraft(markdown) {
    const lines = markdown.split('\n');
    const start = lines.findIndex((l) => /^##\s+.*revised issue draft/i.test(l));
    if (start === -1) return null;

    let end = lines.findIndex((l, i) => i > start && /^##\s+.*next steps/i.test(l));
    if (end === -1) end = lines.length;

    const body = lines.slice(start + 1, end);

    const firstHeading = body.findIndex((l) => /^##\s/.test(l));
    if (firstHeading === -1) return null;

    const content = body.slice(firstHeading);
    while (content.length && /^(\s*|-{3,})$/.test(content[content.length - 1])) content.pop();

    return content.filter((l) => l.trim()).length >= 3 ? content.join('\n') : null;
}

const HIDEABLE_SECTIONS = /^(context|dependencies)$/i;

/** Hides Context/Dependencies sections that only contain unfilled [placeholders]; reports what was hidden. */
function hidePlaceholderSections(text) {
    const hidden = [];

    const kept = text.split(/^(?=##\s)/m).filter((part) => {
        const lines = part.split('\n');
        const heading = lines[0].match(/^##\s+(.*)$/);
        if (!heading || !HIDEABLE_SECTIONS.test(heading[1].trim())) return true;

        const content = lines.slice(1).filter((l) => l.trim());
        const onlyPlaceholders = content.length > 0 && content.every((l) => /\[[^\]]+\]/.test(l));
        if (onlyPlaceholders) hidden.push(heading[1].trim());
        return !onlyPlaceholders;
    });

    return { text: kept.join('').trim(), hidden };
}

// ============================================================================
// CONFIG
// ============================================================================

const githubOwner = process.env.GITHUB_OWNER;
const githubRepo = process.env.GITHUB_REPO;
// Same host and model as the AI checks themselves (src/llm-client.js).
const llmHost = LITELLM_HOST;
const modelName = MODEL_NAME;

const isDemoRepo = githubOwner === 'MKalder' && githubRepo === 'phrom-backlog-demo';
const repoLabel = isDemoRepo
    ? 'demo repository'
    : githubOwner && githubRepo
        ? `${githubOwner}/${githubRepo}`
        : 'not configured';

const aiEndpoint = describeAiEndpoint(llmHost, modelName);
const llmHostname = aiEndpoint.hostname;
const isLocalAI = aiEndpoint.isLocal;
const remoteNote = `${llmHostname || llmHost} (remote host)`;

let octokit = null;
let resolvedModel = modelName;

async function fetchIssue(number) {
    if (!octokit) return null;
    try {
        const { data } = await octokit.issues.get({
            owner: githubOwner,
            repo: githubRepo,
            issue_number: number,
        });
        return { title: data.title, body: (data.body ?? '').trim() };
    } catch {
        return null;
    }
}

// ============================================================================
// BANNER
// ============================================================================

printBanner('1.0.0');

console.log(`  Repository  ${repoLabel}`);
console.log('  Mode        read-only');
console.log(
    isLocalAI
        ? `  AI          local ${dim('· no backlog data sent off this machine')}\n`
        : `  AI          ${remoteNote} ${dim('· issue content leaves this machine')}\n`
);

// ============================================================================
// PREFLIGHT
// ============================================================================

const checks = [];
const addCheck = (name, status, detail = '') => checks.push({ name, status, detail });

// --- 1. Environment ---
if (githubOwner && githubRepo) {
    addCheck('Environment', 'ok', '.env loaded');
} else {
    addCheck('Environment', 'fail', 'GITHUB_OWNER / GITHUB_REPO missing in .env');
}

// --- 2. GitHub ---
if (githubOwner && githubRepo) {
    try {
        const { Octokit } = await import('@octokit/rest');
        // Octokit logs failed requests to the console by itself; keep the demo output clean.
        const silent = { debug() { }, info() { }, warn() { }, error() { } };
        octokit = new Octokit({ auth: process.env.GITHUB_TOKEN, log: silent });
        await octokit.repos.get({ owner: githubOwner, repo: githubRepo });
        addCheck('GitHub', 'ok', repoLabel);
    } catch (error) {
        octokit = null;
        addCheck('GitHub', 'fail', error.message);
    }
} else {
    addCheck('GitHub', 'fail', 'skipped (environment incomplete)');
}

// --- 3. LiteLLM endpoint ---
let llmModels = null;
try {
    if (!llmHost) throw new Error('LITELLM_HOST not set');
    const response = await fetch(`${llmHost}/v1/models`, {
        headers: process.env.LITELLM_API_KEY ? { Authorization: `Bearer ${process.env.LITELLM_API_KEY}` } : {},
        signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    llmModels = data.data || [];
    addCheck('LiteLLM', 'ok', llmHost);
} catch (error) {
    addCheck('LiteLLM', 'fail', `not reachable at ${llmHost || '(not set)'}: ${error.message}`);
}

// --- 4. AI model ---
if (llmModels) {
    const installed = llmModels.find((m) => m.id.includes(modelName));
    if (installed) {
        resolvedModel = installed.id;
        addCheck(modelName, 'ok', 'available through LiteLLM');
    } else {
        addCheck(modelName, 'warn', `not found in LiteLLM's model list – check its config`);
    }
} else {
    addCheck(modelName, 'warn', 'not checked (LiteLLM unreachable)');
}

// --- Results: compact on success, detailed on problems or --verbose ---
const hasFailure = checks.some((c) => c.status === 'fail');
const allOk = checks.every((c) => c.status === 'ok');

if (verbose || !allOk) {
    console.log(bold('Preflight\n'));
    for (const check of checks) {
        console.log(`  ${SYMBOL[check.status]} ${check.name.padEnd(20)}${dim(check.detail)}`);
    }
} else {
    console.log(`  ${SYMBOL.ok} Preflight passed ${dim(`(${checks.length} checks)`)}`);
}

if (hasFailure) {
    console.error(`\n${red('✖ Preflight failed.')} Please fix the errors above and try again.\n`);
    process.exit(1);
}

console.log(`\n${RULE}`);

// ============================================================================
// 1. BACKLOG OVERVIEW
// ============================================================================

const formalStart = performance.now();

section('1. BACKLOG OVERVIEW');

let listOutput;
try {
    listOutput = await run('npm run phrom list --silent');
} catch {
    console.error(`  ${SYMBOL.fail} Failed to load issues\n`);
    process.exit(1);
}

const listedIssues = parseIssueList(listOutput);
const countMatch = listOutput.match(/Found (\d+) open issues/);
const issueCount = countMatch ? Number(countMatch[1]) : listedIssues.length;

console.log(`  ${bold(issueCount)} open issues`);

// ============================================================================
// 2. FORMAL PRE-CHECK
// ============================================================================

section('2. FORMAL PRE-CHECK (rule-based, no AI)');

let statusOutput = '';
try {
    statusOutput = await run('npm run phrom status --silent');
} catch {
    console.error(`  ${SYMBOL.fail} Failed to run the formal pre-check\n`);
    process.exit(1);
}

// Counts from the summary block of `phrom status` ("🟢 at least 80 % … : 8").
const summaryBlock = statusOutput.split('=== Formal pre-check ===')[1] ?? '';
const pickCount = (emoji) => {
    const match = summaryBlock.match(new RegExp(`${emoji}[^:\\n]*:\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
};

const high = pickCount('🟢');
const partial = pickCount('🟡');
const low = pickCount('🔴');

const formalMs = performance.now() - formalStart;
const formalScores = parseFormalScores(statusOutput);

const show = (value) => (value === null ? '?' : value);

// Same bands and counts as `phrom status` (taken from its summary block).
const countsKnown = [high, partial, low].every((value) => value !== null);
const assessedCount = countsKnown ? high + partial + low : issueCount;
const width = String(assessedCount).length;
const cell = (value) => String(show(value)).padStart(width);

// Per-issue lines "– <n>/50 (det: p/t)" of `phrom status`: which issues pass ALL formal checks.
const formalKnown = formalScores.size > 0;
const formalValues = [...formalScores.values()];
const complete = formalValues.filter((f) => f.total > 0 && f.passed === f.total).length;
const withGaps = formalKnown ? formalScores.size - complete : null;
// The ≥ 80 % band also contains issues with a gap (e.g. 4 of 5 checks passed).
const highWithGaps = formalValues.filter((f) => f.score >= 40 && f.passed < f.total).length;
// Show the split only if it adds up to the band from the status summary.
const showSplit = formalKnown && high !== null && complete + highWithGaps === high;

console.log(`  ${DOT.ready} ≥ 80 % of checks passed   ${cell(high)}`);
if (showSplit) {
    console.log(dim(`    ├ ${'all checks passed'.padEnd(24)}${cell(complete)}`));
    console.log(dim(`    └ ${'with gaps'.padEnd(24)}${cell(highWithGaps)}`));
}
console.log(`  ${DOT.needsWork} 50–79 %                   ${cell(partial)}`);
console.log(`  ${DOT.notReady} < 50 %                    ${cell(low)}`);
console.log(`    ${'Total'.padEnd(26)}${cell(assessedCount)}`);

if (formalKnown) {
    console.log(dim(`\n  ${withGaps} of ${formalScores.size} issues have at least one formal gap.`));
}
console.log(dim('  Formal pre-check only – not a readiness verdict. The AI analysis below assesses'));
console.log(dim('  semantic aspects: testability, value and size risk.'));

// ============================================================================
// 3. AI ANALYSIS
// ============================================================================

const aiStart = performance.now();

section(`3. AI ANALYSIS (showcase: 2 of ${issueCount} issues)`);

/**
 * Picks issues from the CURRENT backlog (never hard-coded numbers, issues can be deleted):
 *  - showcase: the story with the most formal gaps → strongest before/after example
 *  - contrast: the story that looks best formally → shows what AI checks add
 * Override the showcase with --showcase=<n>.
 */
function pickDemoIssues() {
    const stories = listedIssues.filter((issue) => issue.labels.includes('type:story'));
    const pool = stories.length > 0 ? stories : listedIssues;
    const formal = (issue) => formalScores.get(issue.number)?.score ?? 50;

    const ascending = [...pool].sort((a, b) => formal(a) - formal(b) || a.number - b.number);

    let showcase = ascending[0];
    if (forcedShowcase) {
        showcase = listedIssues.find((issue) => issue.number === forcedShowcase);
        if (!showcase) return { error: `Issue #${forcedShowcase} is not among the ${listedIssues.length} open issues.` };
    }

    const contrast = [...ascending].reverse().find((issue) => issue.number !== showcase?.number);
    return { picks: [showcase, contrast].filter(Boolean) };
}

const { picks: demoIssues = [], error: pickError } = pickDemoIssues();

if (pickError || demoIssues.length === 0) {
    console.error(`  ${SYMBOL.fail} ${pickError ?? 'No suitable issues found in the backlog.'}\n`);
    process.exit(1);
}

const analysisResults = [];
const analysisFailures = [];

for (const demo of demoIssues) {
    let selectOutput = '';
    let failure = null;

    await withSpinner(`Analyzing #${demo.number} ${demo.title}…`, async () => {
        try {
            selectOutput = await run(`npm run phrom select ${demo.number} --silent`);
        } catch (error) {
            failure = explainError(error);
        }
    });

    if (failure) {
        console.log(`  ${SYMBOL.fail} #${demo.number}  ${truncate(demo.title, 22)} ${dim(`– ${failure}`)}`);
        analysisFailures.push({ number: demo.number, reason: failure });
        continue;
    }

    const { score, status } = resolveAssessment(demo.number, selectOutput);
    const { dot, text } = status ?? { dot: DOT.unknown, text: '' };
    const scoreCell = score === null ? '    n/a' : `${String(score).padStart(3)}/100`;

    console.log(`  #${demo.number}  ${truncate(demo.title, 22).padEnd(22)} ${dot} ${scoreCell}  ${text}`);
    analysisResults.push({ number: demo.number, title: demo.title, score, status });
}

// ============================================================================
// 4. IMPROVEMENT (BEFORE → AFTER)
// ============================================================================

section('4. IMPROVEMENT');

/** Uses a draft from this run; otherwise lets Phrom generate it via `phrom improve <n>`. */
async function ensureDraft(number) {
    const find = () =>
        latestFileForIssue(DRAFT_DIR, number, { include: /improvement/i, since: startedAtWall });

    let file = find();
    if (file) return file;

    await withSpinner(`Generating improvement draft for #${number}…`, () =>
        run(`npm run phrom improve ${number} --silent`)
    );

    file = find();
    if (!file) throw new Error('no draft file was written to output/improvement-suggestions/');
    return file;
}

let improvementsGenerated = 0;
const showcase = analysisResults.find((issue) => issue.number === demoIssues[0].number);

if (!showcase) {
    console.log(dim(`  Skipped – analysis of #${demoIssues[0].number} failed.`));
} else {
    let draftPath = null;
    let draftError = null;

    try {
        draftPath = await ensureDraft(showcase.number);
    } catch (error) {
        draftError = explainError(error);
    }

    const markdown = readIfExists(draftPath);

    // Score/status: the draft header is authoritative (Phrom's own verdict).
    const fromDraft = markdown
        ? { score: extractScore(markdown), status: normalizeStatus(extractStatus(markdown)) }
        : { score: null, status: null };

    const score = fromDraft.score ?? showcase.score;
    const status = fromDraft.status ?? showcase.status ?? { dot: DOT.unknown, text: '' };
    const scoreSuffix = score === null ? '' : ` · ${score}/100`;

    console.log(`  ${bold(`#${showcase.number} ${showcase.title}`)}  ${status.dot} ${status.text}${scoreSuffix}\n`);

    // --- Findings: parsed from the real Phrom draft ---
    const findings = parseFindings(markdown);

    if (findings.length > 0) {
        console.log(`  Phrom identified ${findings.length} gaps:\n`);
        for (const finding of findings) {
            const kind = finding.kind === 'ai' ? 'AI  ' : 'rule';
            const problem = truncate(finding.problem.split(/(?<=[.!?])\s/)[0] ?? '', 52);
            console.log(`  ${SYMBOL.fail} ${finding.name.padEnd(18)} ${dim(kind)}  ${dim(problem)}`);
        }

        const aiCount = findings.filter((f) => f.kind === 'ai').length;
        console.log(dim(`\n  ${findings.length - aiCount} rule-based gaps · ${aiCount} AI-assessed gaps\n`));
    } else if (draftPath) {
        console.log(`  ${SYMBOL.warn} No gap list found in ${relPath(draftPath)}\n`);
    }

    // --- BEFORE: original issue from GitHub ---
    const original = await fetchIssue(showcase.number);
    const beforeBody = original?.body ? original.body.split('\n').slice(0, 8).join('\n') : '';

    printBlock('BEFORE', [
        bold(original?.title ?? showcase.title),
        ...(beforeBody ? renderMarkdown(beforeBody) : [dim('(no description)')]),
    ]);

    // --- AFTER: revised draft produced by Phrom ---
    const revised = extractRevisedDraft(markdown);

    if (revised) {
        const { text, hidden } = showFull ? { text: revised, hidden: [] } : hidePlaceholderSections(revised);

        improvementsGenerated = 1;
        printBlock('AFTER', renderMarkdown(text), 'revised draft by Phrom');

        if (hidden.length > 0) {
            console.log(dim(`  Hidden (placeholders only): ${hidden.join(', ')} · show all: --full\n`));
        }
    } else {
        const reason = draftError ?? 'no revised draft in the output';
        console.log(`  ${SYMBOL.warn} Could not show the improved ticket ${dim(`(${reason})`)}\n`);
    }

    if (draftPath) {
        console.log(dim(`  Full analysis: ${relPath(draftPath)}`));
    }
}

const aiMs = performance.now() - aiStart;

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n${RULE}\n`);

const demoSucceeded = analysisResults.length > 0 && improvementsGenerated > 0;

if (demoSucceeded) {
    console.log(`${SYMBOL.ok} ${bold('Demo complete')}\n`);
} else {
    console.log(`${SYMBOL.warn} ${bold('Demo incomplete')}`);
    for (const failure of analysisFailures) {
        console.log(dim(`  #${failure.number}: ${failure.reason}`));
    }
    console.log();
    process.exitCode = 1;
}

const row = (left, right) => console.log(`  ${left.padEnd(32)}${dim(right)}`);

row(`${assessedCount} issues pre-checked`, `rule-based · ${fmtDuration(formalMs)}`);
row(`${analysisResults.length} issues analyzed with AI`, `${resolvedModel} · ${fmtDuration(aiMs)}`);
row(`${improvementsGenerated} improvement generated`, 'before → after');

if (formalKnown) {
    console.log(`\n  ${complete} pass all formal checks · ${withGaps} have at least one formal gap`);
}

if (analysisResults.length > 0) {
    console.log(
        isLocalAI
            ? `\n  ${SYMBOL.ok} AI ran locally – no issue data left this machine.`
            : `\n  ${SYMBOL.warn} AI did not run locally: ${remoteNote}.`
    );
}

console.log(dim('\n  Reports: output/reports/ · output/improvement-suggestions/'));

// ============================================================================
// NEXT STEPS
// ============================================================================

console.log(`\n${bold('Next')}\n`);

if (demoSucceeded && formalKnown) {
    const remaining = Math.max(withGaps - 1, 0);
    if (remaining > 0) {
        console.log(`  → ${remaining} more issues have formal gaps: npm run phrom improve <issue-number>`);
    }
}

if (isDemoRepo) {
    console.log('  → Run Phrom on your own backlog (see README, Option B)\n');
} else {
    console.log('  → Seed demo data in your repository: npm run seed');
    console.log(dim('    requires: gh auth login\n'));
}