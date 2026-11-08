/**
 * Phrom Model-Improvement Generator (Phase 2)
 * LLM-powered improvement suggestions AND complete issue draft.
 */

import { chatCompletion } from './llm-client.js';

/**
 * Runs a generation and returns the complete text.
 *
 * Uses the same chat-completions endpoint as model.js, with a single user message instead of a
 * raw prompt string: the OpenAI-compatible API has no separate "completion" endpoint for a bare
 * prompt the way Ollama's /api/generate did, so every call goes through chat completions now.
 */
async function generateText(prompt, options, format) {
  const text = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    format,
    options,
  });
  return text.trim();
}

/** "goalStatement", "goal-statement" and "Goal_Statement" are the same criterion. */
const normalizeId = (id) => String(id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Safety net against invented facts. Issue references, percentages, ISO dates and quarters are only kept if the
 * original issue contains them; everything else becomes a placeholder.
 */
export function sanitizeDraft(draft, originalText = '') {
  const original = String(originalText);
  let text = draft;
  let replaced = 0;

  const swap = (pattern, placeholder) => {
    text = text.replace(pattern, (match) => {
      if (original.includes(match)) return match;
      replaced += 1;
      return placeholder;
    });
  };

  swap(/#\d+/g, '#[number]');
  swap(/\b\d+(?:[.,]\d+)?\s?%/g, '[x]%');
  swap(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g, '[date]');
  swap(/\bQ[1-4]\b/g, '[quarter]');

  return { text, replaced };
}

/** Required draft structure per issue type (only the matching one is sent to the model). */
const STRUCTURES = {
  story: `## Context
- Operator: [your company/product]
- Product: [product name]
- Target Group: [user group]
- Part of Epic: #[number] [epic title]

## Story
As a [role], I want [feature], so that [benefit].

## Acceptance Criteria
**Happy Path**
- [ ] Given [initial context], when [action], then [expected result]

**Error Cases**
- [ ] Given [error context], when [action], then [error message / behavior]

## Dependencies
- Depends on #[number] ([title])
- Blocks #[number] ([title])
- Related to #[number] ([title])`,
  epic: `## Context
## Company Goal
## Goal
## Benefits
## Scope
### In Scope
### Out of Scope
## Owner
## Stakeholders
## Child Stories / Candidate Slices
## Milestones
## Success Measures
## Risks and Mitigations
## Dependencies`,
  task: `## Context
## Justification
## Technical Scope
## Impact Analysis
## Rollback Plan
## Verification Criteria
## Dependencies`,
  bug: `## Steps to Reproduce
## Expected Behavior
## Actual Behavior
## Environment
## Severity
## Reproducibility
## Verification Criteria`,
};

/**
 * Generate a complete revised issue draft based on one reference quality example.
 * Returns Markdown.
 *
 * @param {Object} issue - Issue object: title, body, number, type
 * @param {Array} suggestions - Array of improvement suggestions
 * @param {Object} reference - Reference quality example for this type
 * @returns {Promise<string>} Markdown issue draft
 */
export async function generateRevisedIssueDraft(issue, suggestions, reference) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return '';
  }

  const type = issue.type || 'unknown';

  const prompt = `
You are an expert product owner. Create a COMPLETE revised issue draft.

REFERENCE ${type.toUpperCase()} (style and quality guide – DO NOT copy concrete values):
${JSON.stringify(reference, null, 2)}

ORIGINAL ISSUE:
Title: ${issue.title}
Current Description:
${issue.body || '(empty)'}

IMPROVEMENT SUGGESTIONS (incorporate all of these):
${suggestions
      .map(
        (s, i) =>
          `${i + 1}. ${s.check}\n   Problem: ${s.suggestion}\n   Recommended: ${s.after}`
      )
      .join('\n')}

YOUR TASK:
Write a COMPLETE revised issue description that:
1. Follows the STRUCTURE and STYLE of the reference
2. Addresses ALL improvement suggestions above
3. Uses [placeholders] for information that cannot be inferred from the original issue
4. Marks uncertain information as "Open discovery question: [question]"
5. Does NOT copy concrete names, numbers, issue IDs, dates, metrics, systems, or business facts from the reference
6. Is written entirely in English
7. NEVER invents issue numbers, dates, quarters, percentages, thresholds, user counts, standards, tools or scope items. If the original issue does not state it, write a [placeholder] or an "Open discovery question: [question]" instead
9. For sections of the required structure where the ORIGINAL ISSUE contains no information (for example Scope, Owner, Stakeholders, Milestones, Success Measures, Risks, Dependencies), writes ONLY [placeholders] or "Open discovery question: [question]". Do not propose content, numbers or thresholds for them
8. Lists candidate stories or slices WITHOUT issue numbers (for example "- [Slice: user outcome]"). Only reference an issue number that appears in the ORIGINAL ISSUE above

REQUIRED STRUCTURE (adapt based on type):
${STRUCTURES[type] ?? STRUCTURES.story}

OUTPUT:
Provide ONLY the Markdown issue description. No JSON, no explanations, no meta-commentary.
`.trim();

  try {
    const draft = await generateText(prompt, { temperature: 0.3, top_p: 0.9 });

    if (!draft) {
      console.warn('LLM returned an empty revised issue draft.');
      return '';
    }

    const { text, replaced } = sanitizeDraft(draft, `${issue.title}\n${issue.body ?? ''}`);
    if (replaced > 0) {
      console.warn(`Draft: ${replaced} invented value(s) (issue numbers, percentages, dates, quarters) replaced by placeholders.`);
    }

    return text;
  } catch (error) {
    console.error(`Revised draft generation failed: ${error.message}`);
    return '';
  }
}

/**
 * Generate improvement suggestions using LLM + reference quality example.
 * Returns array of suggestions with check, suggestion, before, after.
 *
 * @param {string} type - Issue type: story | task | bug | epic
 * @param {Object} issue - Issue object: title, body, number, type
 * @param {Array} failedCriteria - Failed criterion IDs
 * @param {Object} reference - Reference quality example for this type
 * @returns {Promise<Array>} Suggestions
 */
export async function generateLLMImprovements(type, issue, failedCriteria, reference) {
  if (!Array.isArray(failedCriteria) || failedCriteria.length === 0) {
    return [];
  }

  const failedCriteriaCount = failedCriteria.length;

  const prompt = `
You are an expert product owner. Generate ${failedCriteriaCount} improvement suggestions.

ISSUE:
Title: ${issue.title}
Body: ${issue.body?.slice(0, 500) || '(empty)'}

FAILED CRITERIA (${failedCriteriaCount}):
${failedCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

REFERENCE ${type.toUpperCase()} (style guide only – do NOT copy values):
${JSON.stringify(reference).slice(0, 1500)}...

TASK:
Return EXACTLY ${failedCriteriaCount} JSON objects (one per failed criterion):
{
  "check": "criterion-id",
  "suggestion": "What to improve",
  "before": "Current text or (not present)",
  "after": "Recommended text with [placeholders]"
}

RULES:
- ONE suggestion per failed criterion
- Use [placeholders] for unknown info
- Do NOT copy reference values
- Output ONLY the JSON array, nothing else

EXAMPLE OUTPUT (use the exact criterion IDs from the list above as "check"):
[
  {"check":"${failedCriteria[0]}","suggestion":"What to improve","before":"(not present)","after":"Recommended text with [placeholders]"}
]
`.trim();

  try {
    const rawResponse = await generateText(prompt, { temperature: 0.2, top_p: 0.9 }, 'json');

    if (!rawResponse) {
      console.warn('LLM returned an empty improvement response.');
      return [];
    }

    let parsed;

    try {
      parsed = JSON.parse(rawResponse);
    } catch (parseError) {
      console.warn(`Failed to parse LLM improvement response as JSON: ${parseError.message}`);
      console.warn(`Raw response preview: ${rawResponse.slice(0, 300)}...`);
      return [];
    }

    /*
     * Compatibility layer:
     * Handle various LLM output formats including single objects
     */
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (Array.isArray(parsed.suggestions)) {
        console.warn('LLM returned an object with .suggestions; unwrapping the array.');
        parsed = parsed.suggestions;
      } else if (Array.isArray(parsed.improvements)) {
        console.warn('LLM returned an object with .improvements; unwrapping the array.');
        parsed = parsed.improvements;
      } else if (Array.isArray(parsed.data)) {
        console.warn('LLM returned an object with .data; unwrapping the array.');
        parsed = parsed.data;
      } else if (
        typeof parsed.check === 'string' &&
        typeof parsed.suggestion === 'string' &&
        typeof parsed.after === 'string'
      ) {
        // NEW: Handle single suggestion object by wrapping it in an array
        console.warn('LLM returned a single suggestion object; wrapping in array.');
        parsed = [parsed];
      } else {
        console.warn(
          `LLM returned an unsupported JSON object. Keys: ${Object.keys(parsed).join(', ') || '(none)'}`
        );
        console.warn(`Raw response preview: ${rawResponse.slice(0, 300)}...`);
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      console.warn(`LLM response is not an array after normalization: ${typeof parsed}`);
      console.warn(`Raw response preview: ${rawResponse.slice(0, 300)}...`);
      return [];
    }

    const canonical = new Map(failedCriteria.map((id) => [normalizeId(id), id]));

    return parsed
      .filter(
        (suggestion) =>
          suggestion &&
          typeof suggestion === 'object' &&
          typeof suggestion.check === 'string' &&
          typeof suggestion.suggestion === 'string' &&
          typeof suggestion.after === 'string'
      )
      .filter((suggestion) => canonical.has(normalizeId(suggestion.check)))
      .map((suggestion) => ({
        check: canonical.get(normalizeId(suggestion.check)),
        suggestion: suggestion.suggestion.trim(),
        before:
          typeof suggestion.before === 'string' && suggestion.before.trim()
            ? suggestion.before.trim()
            : '(not present)',
        after: suggestion.after.trim(),
      }));
  } catch (error) {
    console.error(`LLM improvement generation failed: ${error.message}`);
    return [];
  }
}