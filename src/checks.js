/**
 * checks.js – Deterministische Prüfungen für Phrom (vollständig, alle Typen).
 *
 * Diese Funktionen prüfen Issues ohne Modell, rein regelbasiert.
 * Rückgabe: { passed: boolean, evidence?: string, reason?: string }
 *
 * NOTE: Funktionsnamen bleiben unverändert (CamelCase).
 * Die Keys werden in agent.js durch runDeterministicChecks() bestimmt.
 */

/**
 * checkStoryFormat(body) – Prüft das Story-Format.
 */
export function checkStoryFormat(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const germanPatterns = [
    /als\s+\w+.*\s+möchte\s+ich\s+.*\s+damit\s+.*/i,
    /als\s+\w+.*\s+möchte\s+ich\s+.*\s+um\s+.*\s+zu\s+.*/i,
    /als\s+\w+.*\s+will\s+ich\s+.*\s+damit\s+.*/i,
  ];

  const englishPatterns = [
    /as\s+a\s+\w+.*\s+i\s+want\s+.*\s+so\s+that\s+.*/i,
    /as\s+a\s+\w+.*\s+i\s+want\s+.*\s+in\s+order\s+to\s+.*/i,
    /as\s+a\s+\w+.*\s+i\s+need\s+.*\s+so\s+that\s+.*/i,
    /as\s+a\s+\w+.*\s+i\s+should\s+be\s+able\s+to\s+.*\s+so\s+that\s+.*/i,
  ];

  const alternativePatterns = [
    /in\s+order\s+to\s+.*,\s*as\s+a\s+\w+.*\s+i\s+want\s+.*/i,
    /um\s+.*\s+zu\s+.*,\s*als\s+\w+.*\s+möchte\s+ich\s+.*/i,
  ];

  const allPatterns = [...germanPatterns, ...englishPatterns, ...alternativePatterns];
  const matchedPattern = allPatterns.find(pattern => pattern.test(body));

  if (matchedPattern) {
    return { passed: true, evidence: "Story format found (recognized pattern)" };
  }

  const hasRole = /(als|as)\s+(a\s+)?\w+/i.test(body);
  const hasWant = /(möchte|will|want|need|should be able to)/i.test(body);
  const hasWhy = /(damit|um.*zu|so that|in order to)/i.test(body);

  if (hasRole && hasWant && hasWhy) {
    return { passed: true, evidence: "Story elements found (role, want, why), but not in standard format" };
  }

  return {
    passed: false,
    reason: "No story format found. Expected: 'As a [role], I want [goal] so that [benefit]' or 'Als [Rolle], möchte ich [Ziel] damit [Nutzen]'",
  };
}

/**
 * checkContext(body) – Prüft, ob Kontext (Produkt, Zielgruppe) benannt ist.
 */
export function checkContext(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const productKeywords = [
    "product", "feature", "system", "module", "component",
    "portal", "app", "application", "platform", "service"
  ];

  const userKeywords = [
    "user", "customer", "client", "consumer", "end user",
    "admin", "operator", "stakeholder", "role",
    "zielgruppe", "kunde", "benutzer", "anwender"
  ];

  const businessKeywords = [
    "business", "value", "benefit", "goal", "objective",
    "requirement", "need", "pain point", "problem"
  ];

  // Whole-word matching: "app" must not match "applied", "need" not "needed" etc.
  const foundProduct = findWords(body, productKeywords);
  const foundUser = findWords(body, userKeywords);
  const foundBusiness = findWords(body, businessKeywords);

  // Rule: product AND target group must be named (business value is judged by the AI check).
  if (foundProduct.length === 0 || foundUser.length === 0) {
    const missing = [
      foundProduct.length === 0 ? "product" : null,
      foundUser.length === 0 ? "target group" : null,
    ].filter(Boolean).join(" and ");
    return {
      passed: false,
      reason: `No context (${missing}) found. Name the product and the target group (e.g., 'Context: Customer Portal, residential customers').`,
    };
  }

  const evidence = [
    `Product: ${foundProduct.slice(0, 2).join(", ")}`,
    `User: ${foundUser.slice(0, 2).join(", ")}`,
    foundBusiness.length > 0 ? `Business: ${foundBusiness.slice(0, 2).join(", ")}` : null,
  ].filter(Boolean);

  return { passed: true, evidence: `Context found: ${evidence.join("; ")}` };
}

/**
 * checkEpicLink(body) – Prüft, ob ein Epic-Link vorhanden ist.
 */
export function checkEpicLink(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const issueRegex = /(?:[\w-]+\/[\w-]+)?#\d+/g;
  const matches = body.match(issueRegex) || [];

  if (matches.length === 0) {
    return { passed: false, reason: "No epic link (e.g., '#1' or 'owner/repo#1') found" };
  }

  const epicContextKeywords = [
    "epic", "parent", "part of", "belongs to", "under",
    "related to", "tracking", "initiative"
  ];

  const hasEpicContext = epicContextKeywords.some(keyword => body.toLowerCase().includes(keyword));

  if (matches.length === 1 && !hasEpicContext) {
    return { passed: true, evidence: `Epic link found: ${matches[0]} (single reference, likely parent epic)` };
  }

  if (hasEpicContext) {
    return { passed: true, evidence: `Epic link(s) found: ${matches.join(", ")} (with epic context)` };
  }

  return {
    passed: false,
    reason: `Multiple issue references found (${matches.join(", ")}), but no epic context. Please specify which is the parent epic.`,
  };
}

/**
 * checkACPresence(body) – Prüft, ob Acceptance Criteria vorhanden sind.
 */
export function checkACPresence(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const checklistPattern = /^[\s]*[-*]\s*\[\s*\]\s+.*/gim;
  const checklistItems = body.match(checklistPattern) || [];

  const gherkinPattern = /^(Given|When|Then|And|But)\s+/gim;
  const gherkinLines = body.match(gherkinPattern) || [];
  const gherkinScenarios = Math.ceil(gherkinLines.length / 3);

  const acSectionPattern = /(?:^|\n)\s*#+\s*(acceptance\s*(criteria)?|test\s*cases?|validation)\s*(?:\n|$)/i;
  const hasAcSection = acSectionPattern.test(body);

  const mustShouldPattern = /\b(must|should|verify that|it is required that)\b/gi;
  const mustShouldMatches = body.match(mustShouldPattern) || [];

  const totalAC = Math.max(
    checklistItems.length,
    gherkinScenarios,
    mustShouldMatches.length > 0 ? mustShouldMatches.length : 0
  );

  if (totalAC === 0 && !hasAcSection) {
    return { passed: false, reason: "No acceptance criteria section found" };
  }

  if (totalAC < 2) {
    // Without checklist, Gherkin or an AC section, the count comes only from words like "must"/"should".
    const onlyModalWords = checklistItems.length === 0 && gherkinLines.length === 0 && !hasAcSection;
    return {
      passed: false,
      reason: onlyModalWords
        ? `No acceptance criteria found (only ${totalAC} "must/should" statement); expected at least 2 criteria (happy path + a negative, empty-state, or error case)`
        : `Only ${totalAC} acceptance criterion found; expected at least 2 (happy path + a negative, empty-state, or error case)`,
    };
  }

  // A second scenario is only useful if it covers something that can go wrong:
  // error, empty state, or authorization. Checked on the criteria text, not on the whole body.
  const acLines = [...checklistItems, ...(body.match(/^\s*(?:Given|When|Then)\b.*$/gim) || [])];
  const acText = acLines.length > 0 ? acLines.join("\n") : body;
  const negativeCase = /\b(?:errors?|fail(?:s|ed|ure|ing)?|invalid|exceptions?|edge case|boundary|not\s+(?:signed|logged)\s+in|unauthori[sz]ed|forbidden|denied|empty|no\s+\w+|cannot|can't|expired|older\s+than|rejected|redirect(?:ed)?)\b/i;

  if (!negativeCase.test(acText)) {
    return { passed: false, reason: `${totalAC} acceptance criteria found, but none covers an error, empty-state, or authorization case` };
  }

  return { passed: true, evidence: `${totalAC} acceptance criteria found (incl. a negative, empty-state, or error case)` };
}

/**
 * checkStoryLinks(body) – Prüft, ob Referenzen zu anderen Stories/Issues existieren.
 */
export function checkStoryLinks(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const linkPatterns = {
    depends: /(?:depends?\s*(?:on)?|blocked\s*(?:by)?|requires?)\s*#?\d+/gi,
    blocks: /(?:blocks?|prevents?|stops?)\s*#?\d+/gi,
    related: /(?:related\s*(?:to)?|see\s*also|refer\s*(?:to)?|compare)\s*#?\d+/gi,
    duplicates: /(?:duplicates?|duplicate\s*of|same\s*as)\s*#?\d+/gi,
  };

  const foundLinks = {};
  for (const [type, pattern] of Object.entries(linkPatterns)) {
    const matches = body.match(pattern) || [];
    if (matches.length > 0) {
      foundLinks[type] = matches;
    }
  }

  if (Object.keys(foundLinks).length === 0) {
    return { passed: true, evidence: "No explicit story links found (optional)" };
  }

  const summary = Object.entries(foundLinks)
    .map(([type, links]) => `${type}: ${links.join(", ")}`)
    .join("; ");

  return { passed: true, evidence: `Story links found: ${summary}` };
}

// =============================================================================
// TASK-SPECIFIC CHECKS
// =============================================================================

/**
 * checkTechnicalScope(body) – Prüft, ob der technische Umfang klar definiert ist.
 */
export function checkTechnicalScope(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const scopePatterns = [
    /##?\s*(what|scope|technical\s*scope)/i,
    /-\s*(upgrade|migrate|implement|create|update|configure|refactor)/i,
  ];

  const hasScopeSection = getSection(body, ["what", "scope", "technical\\s+scope"]) !== null
    || scopePatterns.some(pattern => pattern.test(body));

  if (!hasScopeSection) {
    return { passed: false, reason: "No clear technical scope section found. Add a 'What' or 'Scope' section with specific work items." };
  }

  const actionVerbs = [
    "upgrade", "migrate", "implement", "create", "update", "configure",
    "refactor", "deploy", "setup", "install", "remove", "add"
  ];

  const lines = body.split('\n');
  const actionLines = lines.filter(line => {
    const lowerLine = line.toLowerCase();
    return actionVerbs.some(verb => lowerLine.includes(verb)) &&
      (line.trim().startsWith('-') || line.trim().startsWith('*'));
  });

  if (actionLines.length < 2) {
    return { passed: false, reason: `Only ${actionLines.length} action item found. Expected at least 2 specific work items.` };
  }

  return { passed: true, evidence: `${actionLines.length} technical work items identified (e.g., "${actionLines[0].trim()}")` };
}

/**
 * checkJustification(body) – Prüft, ob die Begründung (Warum) dokumentiert ist.
 */
export function checkJustification(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const justificationPatterns = [
    /##?\s*(why|reason|justification|background|motivation)/i,
    /\b(eol|end-of-life|security|compliance|performance|debt|deprecated)\b/i,
  ];

  const hasJustification = getSection(body, ["why", "reason", "justification", "background", "motivation"]) !== null
    || justificationPatterns.some(pattern => pattern.test(body));

  if (!hasJustification) {
    return { passed: false, reason: "No justification section found. Add a 'Why' section explaining the driver (e.g., EOL date, security requirement, performance need)." };
  }

  const hasEOL = /\b(eol|end-of-life|Q\d|202\d)\b/i.test(body);
  const hasSecurity = /\bsecurity\b/i.test(body);
  const hasPerformance = /\bperformance\b/i.test(body);
  const hasCompliance = /\bcompliance\b/i.test(body);

  const drivers = [];
  if (hasEOL) drivers.push("EOL/deprecation");
  if (hasSecurity) drivers.push("security");
  if (hasPerformance) drivers.push("performance");
  if (hasCompliance) drivers.push("compliance");

  if (drivers.length === 0) {
    return { passed: false, reason: "Justification section exists but lacks concrete driver (EOL date, security requirement, performance need, compliance)." };
  }

  return { passed: true, evidence: `Justification includes: ${drivers.join(", ")}` };
}

/**
 * checkImpactAnalysis(body) – Prüft, ob Impact-Analyse vorhanden ist.
 */
export function checkImpactAnalysis(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const impactPatterns = [
    /##?\s*(impact|affected|downtime|risks)/i,
    /\b(affected\s*systems|downtime|maintenance\s*window|rollback)\b/i,
  ];

  const hasImpact = impactPatterns.some(pattern => pattern.test(body));

  if (!hasImpact) {
    return { passed: false, reason: "No impact analysis section found. Add an 'Impact' section listing affected systems, planned downtime, and risks." };
  }

  const hasAffectedSystems = /\b(affected\s*systems|databases|services)\b/i.test(body);
  const hasDowntime = /\b(downtime|window|maintenance)\b/i.test(body);
  const hasRisks = /\b(risks|risk)\b/i.test(body);

  const elements = [];
  if (hasAffectedSystems) elements.push("affected systems");
  if (hasDowntime) elements.push("downtime/window");
  if (hasRisks) elements.push("risks");

  if (elements.length < 2) {
    return { passed: false, reason: `Impact section exists but incomplete. Found: ${elements.join(", ")}. Missing: ${elements.length === 1 ? "affected systems + downtime/risks" : "additional elements"}.` };
  }

  return { passed: true, evidence: `Impact analysis includes: ${elements.join(", ")}` };
}

/**
 * checkRollbackPlan(body) – Prüft, ob ein Rollback-Plan dokumentiert ist.
 */
export function checkRollbackPlan(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  // Heading ("## Rollback Plan"), bold label ("**Rollback Plan:** …") or plain label ("Rollback: …")
  const hasRollbackSection = getSection(body, ["rollback"]) !== null || /##?\s*rollback/i.test(body);

  if (!hasRollbackSection) {
    return { passed: false, reason: "No rollback plan section found. For production-impacting tasks, a tested rollback procedure is mandatory." };
  }

  const hasProcedure = /\b(procedure|steps|restore|backup)\b/i.test(body);
  const hasTested = /\b(tested|test)\b/i.test(body);
  const hasTimeEstimate = /\b(\d+\s*(minutes?|hours?)|within\s+\d+)\b/i.test(body);
  const hasLocation = /\b(runbook|documented\s*in|location)\b/i.test(body);

  const details = [];
  if (hasProcedure) details.push("procedure");
  if (hasTested) details.push("tested");
  if (hasTimeEstimate) details.push("time estimate");
  if (hasLocation) details.push("location (runbook)");

  if (details.length < 2) {
    return { passed: false, reason: `Rollback section exists but incomplete. Found: ${details.join(", ")}. Add: procedure details, testing status, time estimate, and runbook location.` };
  }

  return { passed: true, evidence: `Rollback plan includes: ${details.join(", ")}` };
}

// =============================================================================
// BUG-SPECIFIC CHECKS
// =============================================================================

/**
 * checkReproductionSteps(body) – Prüft, ob Reproduktionsschritte dokumentiert sind.
 */
export function checkReproductionSteps(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const reproductionPatterns = [
    /##?\s*(steps?\s*(to\s*)?reproduce|reproduction|how\s*to\s*reproduce)/i,
    /^\d+\.\s+/m,
    /step\s*\d*:?\s*/i,
  ];

  const hasReproduction = reproductionPatterns.some(pattern => pattern.test(body));

  if (!hasReproduction) {
    return { passed: false, reason: "No reproduction steps found. Add numbered steps to reproduce the bug (e.g., '1. Go to..., 2. Click..., 3. Observe error')." };
  }

  const numberedSteps = body.match(/^\d+\.\s+/gm) || [];
  const stepXSteps = body.match(/step\s*\d*:?\s*/gi) || [];
  const totalSteps = Math.max(numberedSteps.length, stepXSteps.length);

  if (totalSteps < 2) {
    return { passed: false, reason: `Only ${totalSteps} reproduction step found. Expected at least 2-3 steps for proper reproduction.` };
  }

  return { passed: true, evidence: `${totalSteps} reproduction steps documented` };
}

/**
 * checkExpectedVsActual(body) – Prüft, ob Expected vs. Actual Behavior beschrieben ist.
 */
export function checkExpectedVsActual(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const expectedPatterns = [
    /##?\s*(expected|actual|behavior|result)/i,
    /\bexpected\s*(behavior|result|outcome)/i,
    /\bactual\s*(behavior|result|outcome)/i,
    /\binstead\s*(of|got)/i,
  ];

  // Heading ("## Expected"), bold label ("**Expected:** …") or plain label ("Expected: …")
  const labelled = getSection(body, ["expected"]) !== null && getSection(body, ["actual"]) !== null;
  const hasExpectedVsActual = labelled || expectedPatterns.some(pattern => pattern.test(body));

  if (!hasExpectedVsActual) {
    return { passed: false, reason: "No 'Expected vs. Actual' section found. Add clear description of expected behavior and actual behavior (e.g., 'Expected: PDF downloads. Actual: Error 500')." };
  }

  const hasExpected = /\bexpected\b/i.test(body);
  const hasActual = /\b(actual|instead|but got)\b/i.test(body);

  if (!hasExpected || !hasActual) {
    return { passed: false, reason: "Expected vs. Actual section exists but incomplete. Ensure both expected behavior AND actual behavior are described." };
  }

  return { passed: true, evidence: "Expected and actual behavior documented" };
}

/**
 * checkEnvironmentInfo(body) – Prüft, ob Umgebungsinformationen vorhanden sind.
 */
export function checkEnvironmentInfo(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const environmentPatterns = [
    /##?\s*(environment|system\s*info|configuration)/i,
    /\b(browser|os|version|device|platform|ios|android|windows|mac|safari|chrome|firefox)\b/i,
  ];

  const hasEnvironment = getSection(body, ["environment", "system\\s+info", "configuration"]) !== null
    || environmentPatterns.some(pattern => pattern.test(body));

  if (!hasEnvironment) {
    return { passed: false, reason: "No environment information found. Add details about browser, OS, device, and version where the bug occurs." };
  }

  // Named products count as details, not only the generic words ("Safari" is a browser, "iOS 17" is OS + version).
  const details = [];
  if (/\b(browser|safari|chrome|firefox|edge|opera)\b/i.test(body)) details.push("browser");
  if (/\b(os|operating\s*system|ios|ipados|android|windows|macos|mac\s*os|linux|ubuntu)\b/i.test(body)) details.push("OS");
  if (/\bversion\b|\b(?:ios|ipados|android|windows|macos|safari|chrome|firefox|edge|v)\s*\d+(?:\.\d+)*/i.test(body)) details.push("version");
  if (/\b(device|mobile|iphone|ipad|pixel|galaxy|tablet|desktop|laptop)\b/i.test(body)) details.push("device");

  if (details.length < 2) {
    return { passed: false, reason: `Environment section exists but incomplete. Found: ${details.join(", ")}. Add at least 2-3 details (browser, OS, version, device).` };
  }

  return { passed: true, evidence: `Environment info includes: ${details.join(", ")}` };
}

// =============================================================================
// EPIC-SPECIFIC CHECKS
// =============================================================================

/**
 * checkGoalStatement(body) – Prüft, ob ein SMART-Epic-Goal formuliert ist.
 */
export function checkGoalStatement(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const section = getSection(body, ["goal", "objective", "aim", "purpose"]);
  const inline = /\b(?:goal|objective)\s+is\s+to\b/i.test(body);

  if (!section && !inline) {
    return { passed: false, reason: "No goal statement found. Add a 'Goal' section describing the outcome the epic should achieve." };
  }

  if (section !== null && wordCount(section) < 5) {
    return { passed: false, reason: "Goal section is too short to state an outcome. Describe who should be able to achieve what." };
  }

  // Structure is checked here; whether the goal is a real outcome is judged by the AI check (epic-goal).
  const text = section ?? body;
  const hints = [];
  if (/\b\d+\s*(?:%|percent)|\b(?:reduce|increase|decrease|improve)\b/i.test(text)) hints.push("measurable");
  if (/\bby\s+(?:Q[1-4]|\d{4})\b|\bdeadline\b|\btarget\s+date\b/i.test(text)) hints.push("time-bound");

  return {
    passed: true,
    evidence: hints.length > 0
      ? `Goal statement found (${hints.join(", ")})`
      : "Goal statement found (no measurable target or deadline; judged by the AI check)",
  };
}

/**
 * checkBenefitStatement(body) – Prüft, ob der Epic-Benefit quantifiziert ist.
 */
export function checkBenefitStatement(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const section = getSection(body, ["benefit", "value", "impact", "outcome"]);
  const inline = /\b(?:benefit|value)\s+(?:is|will\s+be)\b/i.test(body);

  if (!section && !inline) {
    return { passed: false, reason: "No benefit statement found. Add a 'Benefit' section stating who gains what." };
  }

  if (section !== null && wordCount(section) < 5) {
    return { passed: false, reason: "Benefit section is too short. State who gains what." };
  }

  // Structure is checked here; quality is judged by the AI check (epic-benefit).
  const text = section ?? body;
  const quantified = /\b\d+\s*(?:%|percent|minutes?|hours?|days?|tickets?|€|eur|dollars?)|\b(?:reduce|increase|decrease|save)\b/i.test(text);

  return {
    passed: true,
    evidence: quantified
      ? "Benefit statement found (quantified)"
      : "Benefit statement found (not quantified; judged by the AI check)",
  };
}

/**
 * checkStoryList(body) – Prüft, ob Child-Stories verlinkt sind.
 */
export function checkStoryList(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const refs = body.match(/#\d+/g) || [];
  const section = getSection(body, [
    "stories", "child\\s+stories", "candidate\\s+stories", "related\\s+stories", "slices", "candidate\\s+slices",
  ]);
  const items = section ? countBullets(section) : 0;

  if (refs.length >= 2) {
    return {
      passed: true,
      evidence: `${refs.length} child stories referenced: ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? "..." : ""}`,
    };
  }

  if (items >= 2) {
    return { passed: true, evidence: `${items} candidate stories listed` };
  }

  return {
    passed: false,
    reason: "No story list found. Add a 'Stories' section with at least two child stories or candidate slices (e.g., '#[number], #[number]').",
  };
}

/**
 * checkEpicContext(body) – Same contract as checkContext: product and target group must be named.
 * Operator and platforms are recommended but not required (see epic-context in epic-check-criteria.json).
 */
export function checkEpicContext(body) {
  return checkContext(body);
}

/**
 * checkEpicBoundary(body) – Prüft, ob In-Scope und Out-of-Scope benannt sind, jeweils mit Inhalt.
 */
export function checkEpicBoundary(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const inScope = getSection(body, ["in\\s*scope", "in-scope"]);
  const outOfScope = getSection(body, ["out\\s*of\\s*scope", "out-of-scope"]);

  // "Meaningful" means more than a bare heading or a placeholder like "TBD".
  const hasContent = (section) => section !== null && wordCount(section) >= 3;

  if (!hasContent(inScope) || !hasContent(outOfScope)) {
    const missing = [
      !hasContent(inScope) ? "in-scope" : null,
      !hasContent(outOfScope) ? "out-of-scope" : null,
    ].filter(Boolean).join(" and ");
    return {
      passed: false,
      reason: `No explicit ${missing} boundary found. Add 'In Scope' and 'Out of Scope' sections with at least one concrete item each.`,
    };
  }

  return { passed: true, evidence: "In-scope and out-of-scope boundary found" };
}

/**
 * checkEpicOwner(body) – Prüft, ob ein verantwortlicher Owner mit Rolle/Team benannt ist.
 */
export function checkEpicOwner(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const section = getSection(body, ["owner"]);

  if (section === null || wordCount(section) === 0) {
    return {
      passed: false,
      reason: "No owner found. Name one accountable owner with a role or team (e.g., 'Owner: Jane Doe, Platform Team').",
    };
  }

  return { passed: true, evidence: `Owner found: ${section.split("\n")[0].trim()}` };
}

/**
 * checkEpicStakeholders(body) – Prüft, ob mindestens eine Stakeholder-Gruppe benannt ist.
 */
export function checkEpicStakeholders(body) {
  if (!body) {
    return { passed: false, reason: "Body is empty" };
  }

  const section = getSection(body, ["stakeholders?"]);

  if (section === null || wordCount(section) === 0) {
    return {
      passed: false,
      reason: "No stakeholders found. Name at least one stakeholder group or person (e.g., 'Stakeholders: Support, Finance').",
    };
  }

  const items = countBullets(section);
  return {
    passed: true,
    evidence: items > 0 ? `${items} stakeholder group(s) listed` : `Stakeholders found: ${section.split("\n")[0].trim()}`,
  };
}


// ---------------------------------------------------------------------------
// Helpers: whole-word matching and label/heading detection
// ---------------------------------------------------------------------------

/** Words that appear as whole words (plural and German endings tolerated), e.g. "customers", "Kunden". */
function findWords(body, words) {
  return words.filter((word) =>
    new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}(?:s|n|en)?\\b`, "i").test(body)
  );
}

const SECTION_BOUNDARY = /^\s*(?:#{1,6}\s|\*\*[^*\n]+\*\*)/;

/**
 * Returns the text of a section introduced by a heading ("## Goal"), a bold label ("**Goal:** …")
 * or a plain label ("Goal: …"), up to the next heading or label. null if no such section exists.
 */
function getSection(body, names) {
  const start = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?\\s*(?:${names.join("|")})s?\\b[^:\\n]*:?\\s*(?:\\*\\*)?\\s*(.*)$`,
    "i"
  );
  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(start);
    if (!match) continue;

    const looksLikeLabel =
      /^\s*#{1,6}\s*/.test(lines[i]) || /^\s*\*\*/.test(lines[i]) || /^\s*\w[\w\s-]*:/.test(lines[i]);
    if (!looksLikeLabel) continue;

    const content = [match[1]];
    for (let j = i + 1; j < lines.length && !SECTION_BOUNDARY.test(lines[j]); j++) content.push(lines[j]);
    return content.join("\n").trim();
  }
  return null;
}

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const countBullets = (text) =>
  text.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
