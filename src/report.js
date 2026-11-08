/**
 * Phrom Report Generator
 * Generates Markdown reports from processed issue results.
 *
 * Status, score and findings come from the evaluation (agent.js → evaluate()), so the report
 * shows exactly what decided the status, including the Ready Gate.
 *
 * IMPORTANT: NO IMPROVEMENT SUGGESTIONS HERE.
 * Improvements are only generated via cli.js (phrom improve).
 */

// ---------- Normalization ----------

function toCheckArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.checks)) return value.checks;
    if (typeof value === 'object') {
        return Object.entries(value)
            .filter(([, v]) => v && typeof v === 'object' && 'passed' in v)
            .map(([key, v]) => ({ name: key, ...v }));
    }
    return [];
}

function normalizeCheck(c) {
    return {
        name: c.name || c.id || c.check || 'Unnamed check',
        passed: Boolean(c.passed ?? c.pass ?? c.ok),
        // AI checks return a reason, not evidence: show it for passed checks too.
        evidence: c.evidence || (c.passed ? c.reason : '') || c.message || '',
        reason: c.reason || c.message || 'No reason provided.',
    };
}

function modelErrorText(error) {
    if (!error) return null;
    if (typeof error === 'string') return error;
    return error.reason || error.message || JSON.stringify(error);
}

function normalizeResult(result, typeOverride) {
    const src = result || {};
    const issueObj = src.issue || {};
    const modelRaw = src.modelChecks || src.model || src.aiChecks || null;

    return {
        number: issueObj.number ?? src.number ?? src.issueNumber ?? '?',
        title: issueObj.title ?? src.title ?? '(no title)',
        body: src.body || issueObj.body || '',
        type: typeOverride || src.type || issueObj.type || 'unknown',
        score: src.score ?? 0,
        status: src.status ?? 'not-ready',
        summary: src.summary || 'No summary available.',
        evaluation: src.evaluation ?? null,
        checks: toCheckArray(src.checks || src.deterministicChecks || src.deterministic).map(normalizeCheck),
        modelError: modelErrorText(modelRaw && modelRaw.error),
        modelChecks: toCheckArray(modelRaw).map(normalizeCheck),
    };
}

function statusEmoji(status) {
    return status === 'ready' ? '🟢' : status === 'needs-work' ? '🟡' : '🔴';
}

function statusLabel(status) {
    return status === 'ready' ? 'Ready' : status === 'needs-work' ? 'Needs Work' : 'Not Ready';
}

function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------- Findings from the evaluation ----------

/** Failed criteria, required ones first. Falls back to the raw checks for results without evaluation. */
function findingsOf(r) {
    if (r.evaluation && Array.isArray(r.evaluation.failed)) {
        return [...r.evaluation.failed].sort((a, b) => Number(b.required) - Number(a.required));
    }
    return [...r.checks, ...r.modelChecks]
        .filter(c => !c.passed)
        .map(c => ({ id: c.name, required: false, reason: c.reason }));
}

function describeFinding(f, { markRequired = true } = {}) {
    const text = f.reason ? String(f.reason) : 'No result (the check did not run).';
    return `**${f.id}**${markRequired && f.required ? ' (required)' : ''}: ${text}`;
}

function blockedByGate(r) {
    return findingsOf(r).filter(f => f.required).map(f => f.id);
}

// ---------- Sections ----------

function renderCheckSection(checks) {
    const passed = checks.filter(c => c.passed);
    const failed = checks.filter(c => !c.passed);
    let out = '';

    if (passed.length > 0) {
        out += `### ✅ Passed (${passed.length})\n\n`;
        for (const c of passed) out += `- **${c.name}**: ${c.evidence || 'Check passed.'}\n`;
        out += '\n';
    }

    if (failed.length > 0) {
        out += `### ❌ Needs Improvement (${failed.length})\n\n`;
        for (const c of failed) out += `- **${c.name}**: ${c.reason}\n\n`;
    }

    if (checks.length === 0) out += `_No checks available._\n\n`;
    return out;
}

function renderReadyGate(r) {
    const ev = r.evaluation;
    if (!ev || !Array.isArray(ev.results) || ev.results.length === 0) return '';

    const blocked = ev.results.filter(c => c.required && !c.passed);

    let out = `## 🚦 Score and Ready Gate\n\n`;
    out += blocked.length === 0
        ? `**Ready Gate:** ✅ all required criteria passed.\n\n`
        : `**Ready Gate:** ❌ ${blocked.length} required ${blocked.length === 1 ? 'criterion' : 'criteria'} failed (${blocked.map(c => c.id).join(', ')}). ` +
          `The issue cannot be 🟢 Ready, whatever the score.\n\n`;

    out += `| Criterion | Kind | Required | Points | Result |\n`;
    out += `|-----------|------|:--------:|-------:|:------:|\n`;
    for (const c of ev.results) {
        out += `| ${c.id} | ${c.check === 'code' ? 'rule' : 'AI'} | ${c.required ? '✅' : '–'} | ${c.passed ? c.points : 0}/${c.points} | ${c.passed ? '✅' : '❌'} |\n`;
    }
    out += ev.max === 100
        ? `\n**Score:** ${r.score}/100\n\n---\n\n`
        : `\n**Score:** ${ev.earned}/${ev.max} points, normalized to ${r.score}/100\n\n---\n\n`;
    return out;
}

function renderNextSteps(r) {
    const findings = findingsOf(r);
    const required = findings.filter(f => f.required);
    const optional = findings.filter(f => !f.required);
    const numbered = (items, limit) =>
        items.slice(0, limit).map((f, i) => `${i + 1}. ${describeFinding(f, { markRequired: false })}\n`).join('')
        + (items.length > limit ? `…and ${items.length - limit} more (see the checks above).\n` : '');

    let out = `## 🎯 Next Steps\n\n`;

    if (r.status === 'ready') {
        out += `✅ This issue is ready for refinement.\n\n`;
        if (optional.length > 0) {
            out += `Optional improvements:\n\n${numbered(optional, 3)}\n`;
        }
        return out;
    }

    out += r.status === 'needs-work'
        ? `🔧 **Recommended before refinement:**\n\n`
        : `🚨 **Fix before refinement:**\n\n`;

    if (r.modelError) {
        out += `⚠️ The AI checks did not run, so this result is incomplete. Make sure the configured LLM endpoint (LITELLM_HOST) is reachable and analyze the issue again.\n\n`;
    }

    if (required.length > 0) {
        out += `**Required** (these block 🟢 Ready, whatever the score):\n\n${numbered(required, 5)}\n`;
    }
    if (optional.length > 0) {
        out += required.length > 0 ? `**Optional** (raise the score):\n\n` : '';
        out += `${numbered(optional, 3)}\n`;
    }

    out += `Run \`phrom improve ${r.number}\` for concrete suggestions.\n\n`;
    return out;
}

// ---------- Single-issue report ----------

/**
 * @param {Object} result - Processed issue result
 * @param {string} [type] - story | task | bug | epic
 * @returns {string} Markdown
 */
export function generateMarkdownReport(result, type) {
    const r = normalizeResult(result, type);
    const aiPassedCount = r.modelChecks.filter(c => c.passed).length;

    let report = `# ${statusEmoji(r.status)} Issue #${r.number}: "${r.title}"\n\n`;
    report += `**Type:** ${capitalize(r.type)} \n`;
    report += `**Score:** ${r.score}/100 \n`;
    report += `**Status:** ${statusLabel(r.status)} \n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    report += `---\n\n## 📝 Summary\n\n${r.summary}\n\n---\n\n`;

    // Original issue text, so the review happens next to the content that was assessed.
    report += `## 📄 Original Issue\n\n<details>\n<summary>Issue text as assessed</summary>\n\n`;
    report += r.body ? `\`\`\`\`markdown\n${r.body}\n\`\`\`\`\n\n` : `_(empty body)_\n\n`;
    report += `</details>\n\n---\n\n`;

    if (r.type === 'epic') {
        report += `## 🎯 Epic Definition\n\n`;
        report += `An Epic is a large body of work that can be broken down into multiple user stories. It should have:\n`;
        report += `- A goal that describes an outcome, not just an activity\n- A stated benefit for stakeholders\n- A list of child stories or candidate slices\n\n---\n\n`;
    } else if (r.type === 'task') {
        report += `## 🔧 Technical Task Definition\n\n`;
        report += `A Technical Task describes work that is not user-facing (e.g., infrastructure, refactoring, migrations). It should have:\n`;
        report += `- Clear technical scope\n- Justification (why is this needed?)\n- Impact analysis\n- Rollback plan\n\n---\n\n`;
    } else if (r.type === 'bug') {
        report += `## 🐛 Bug Report Definition\n\n`;
        report += `A Bug Report describes unexpected behavior. It should have:\n`;
        report += `- Reproduction steps (numbered, ≥2 steps)\n- Expected vs. actual behavior\n- Environment info (browser, OS, device)\n\n---\n\n`;
    }

    report += `## ✅ Deterministic Checks (Rule-Based)\n\n`;
    report += renderCheckSection(r.checks);
    report += `---\n\n`;

    report += `## 🤖 AI-Powered Checks (LLM-Based)\n\n`;
    if (r.modelError) {
        report += `⚠️ Model checks failed: ${r.modelError}\n\n`;
    } else {
        report += renderCheckSection(r.modelChecks);
    }
    report += `---\n\n`;

    report += renderReadyGate(r);
    report += renderNextSteps(r);

    report += `---\n\n`;
    report += `*Generated by Phrom – Rule-based checks: ${r.checks.filter(c => c.passed).length}/${r.checks.length} passed | AI checks: ${aiPassedCount}/${r.modelChecks.length} passed*\n`;

    return report;
}

// ---------- Summary ----------

/**
 * @param {Array} results - All processed issue results
 * @returns {string} Markdown
 */
export function generateSummaryReport(results) {
    const items = (results || []).map(r => normalizeResult(r));
    const total = items.length;
    const pct = n => (total > 0 ? Math.round((n / total) * 100) : 0);

    const ready = items.filter(r => r.status === 'ready');
    const needsWork = items.filter(r => r.status === 'needs-work');
    const notReady = items.filter(r => r.status === 'not-ready');

    const byType = {};
    for (const r of items) {
        const t = r.type || 'unknown';
        if (!byType[t]) byType[t] = { ready: 0, needsWork: 0, notReady: 0, total: 0 };
        byType[t].total++;
        if (r.status === 'ready') byType[t].ready++;
        else if (r.status === 'needs-work') byType[t].needsWork++;
        else byType[t].notReady++;
    }

    const typeOrder = ['story', 'task', 'bug', 'epic'];
    const sortedTypes = Object.keys(byType).sort((a, b) => {
        const ai = typeOrder.indexOf(a);
        const bi = typeOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });

    // Names the required criteria that blocked an issue, so "80/100 but not ready" is explained.
    const gateNote = r => {
        const blocked = blockedByGate(r);
        if (blocked.length === 0) return '';
        return ` – Ready Gate: ${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? ', …' : ''}`;
    };

    const listSection = (title, list, emptyText, withGate = false) => {
        let out = `## ${title} (${list.length})\n\n`;
        if (list.length > 0) {
            for (const r of list) {
                out += `- **#${r.number}** (${capitalize(r.type)}): "${r.title}" – ${r.score}/100${withGate ? gateNote(r) : ''}\n`;
            }
        } else {
            out += `${emptyText}\n`;
        }
        return out + `\n---\n\n`;
    };

    let report = `# 🤖 Phrom Summary Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n---\n\n`;

    report += `## 📊 Overview\n\n`;
    report += `| Status | Count | Percentage |\n|--------|-------|------------|\n`;
    report += `| 🟢 Ready | ${ready.length} | ${pct(ready.length)}% |\n`;
    report += `| 🟡 Needs work | ${needsWork.length} | ${pct(needsWork.length)}% |\n`;
    report += `| 🔴 Not ready | ${notReady.length} | ${pct(notReady.length)}% |\n`;
    report += `| **Total** | **${total}** | **100%** |\n\n---\n\n`;

    report += `## 📋 Breakdown by Type\n\n`;
    report += `| Type | 🟢 Ready | 🟡 Needs Work | 🔴 Not Ready | Total |\n`;
    report += `|------|----------|---------------|--------------|-------|\n`;
    for (const t of sortedTypes) {
        const c = byType[t];
        report += `| ${capitalize(t)} | ${c.ready} | ${c.needsWork} | ${c.notReady} | ${c.total} |\n`;
    }

    report += `\n---\n\n`;

    report += listSection('🟢 Ready Issues', ready, 'No issues ready.');
    report += listSection('🟡 Needs Work', needsWork, 'No issues need work.');
    report += listSection('🔴 Not Ready', notReady, 'No issues not ready.', true);

    report += `## 🎯 Top 3 Priorities\n\n`;
    const priorities = items
        .filter(r => r.status !== 'ready')
        .sort((a, b) => a.score - b.score)
        .slice(0, 3);

    if (priorities.length === 0) {
        report += `Nothing to prioritize: all issues are ready.\n`;
    }
    priorities.forEach((r, i) => {
        report += `${i + 1}. **#${r.number} "${r.title}"** (${capitalize(r.type)}) – Score: ${r.score}/100\n`;
        const reasons = findingsOf(r).slice(0, 2).map(f => f.reason || f.id).join('; ');
        if (reasons) report += ` - ${reasons}\n`;
    });
    report += `\n---\n\n`;

    report += `## ℹ️ About This Report\n\n`;
    report += `- **Rule-based checks**: regex and pattern matching on the issue text. Instant and reproducible, but keyword-based and therefore not infallible.\n`;
    report += `- **AI-powered checks**: judgments of an LLM served through the endpoint in \`LITELLM_HOST\`, based on the issue text only. An assessment, not a fact.\n`;
    report += `- **Score**: share of the achievable points (0–100). Weights and required criteria are defined per criterion in \`references/criteria/*.json\`.\n`;
    report += `- **Status**: 🟢 Ready = Ready Gate passed and score ≥ 80 · 🟡 Needs Work = Ready Gate passed and score 50–79 · 🔴 Not Ready = Ready Gate failed or score < 50.\n\n`;
    report += `*Generated by Phrom*\n`;

    return report;
}
