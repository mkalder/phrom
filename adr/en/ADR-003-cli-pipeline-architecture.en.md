# ADR-003: CLI Pipeline with Rules Engine, Local AI, and Human-in-the-Loop

- **Status:** Accepted (amended 2026-10-07: Ollama host configuration, draft limitations, measured runtime; runtime updated 2026-10-08. The "Local AI through Ollama" part of this decision is superseded 2026-11-08 by [ADR-006](ADR-006-litellm-backend.en.md): AI calls now go through a self-hosted LiteLLM endpoint, not a local Ollama host. The CLI pipeline, rules engine, and Human-in-the-Loop decisions below are unchanged.)
- **Date:** 2026-10-07
- **Decision-maker:** Marius Kalder (Product Owner / Author of Phrom)
- **Scope:** Overall architecture of `phrom` (CLI, rules engine, AI integration, output, and review step)

## Context

Phrom is intended to assess GitHub Issues before backlog refinement and provide concrete improvement drafts for insufficiently prepared items. This raises several architectural questions:

- Who performs the assessment: a rules engine, a language model, or both?
- Where does the model run: with a provider or locally?
- How autonomous may the system be: does it write to GitHub or only make suggestions?
- How should the workflow be structured: fixed steps or an agent that selects tools itself?
- Where are results stored?

ADR-001 establishes GitHub Issues as the data source, while ADR-002 separates the code and demo backlog. This ADR describes the architecture between them.

## Decision Drivers

- **Traceability:** Every assessment must be explainable. The PO must be able to see why an issue fails.
- **Data control:** Backlog contents must not be sent to an LLM provider.
- **Human decision-making:** Prioritization, estimation, and approval remain with the PO and the team.
- **Reproducibility:** The same input should produce the same output as far as possible.
- **Simplicity:** A solo MVP without a framework, additional infrastructure, or a cloud dependency for the model.
- **Configurability:** Teams should be able to adjust criteria, points, and required flags without changing code.

## Options Considered

**Option A: LLM-only assessment.** The model receives an issue and assesses it freely. Advantages: little code and flexible. Disadvantages: difficult to trace, not reproducible, and the model would also check formal errors that code can detect reliably.

**Option B: Agent with tool selection.** The model decides which tool to run next, such as reading issues, checking rules, or generating a draft. Advantages: flexible and extensible. Disadvantages: less predictable and harder to debug behavior, greater effort for state management and error handling, and unnecessary for the MVP scope.

**Option C: Cloud LLM through an API.** Advantages: more capable models and no local hardware requirements. Disadvantages: backlog contents leave the local environment, recurring costs, and provider dependency.

**Option D: Fixed pipeline with a rules engine, local AI, and a review step.** A Node.js CLI runs fixed steps: read issues, run deterministic checks, run AI checks, apply the Ready Gate, optionally generate an improvement draft, and save results. The PO reviews the output and applies changes manually.

## Decision

I choose **Option D: A fixed pipeline with a rules engine, local AI, and Human-in-the-Loop.**

```txt
PO
 │
 ▼
Node.js CLI (phrom)
 │
 ├── GitHub REST API (read-only) ─► GitHub Issues
 │
 ├── Rules Engine
 │   ├── Criteria ────────────────► references/criteria/*.json (criteria-loader.js)
 │   ├── Deterministic Checks ────► checks.js
 │   └── Score + Ready Gate ──────► agent.js (evaluate)
 │
 ├── AI Engine ───────────────────► model.js → ollama-client.js → Ollama (OLLAMA_HOST)
 │
 ├── Improvement Engine ──────────► improve.js → model-improve.js
 │   └── Reference Examples ──────► references/quality/*.json
 │
 └── Filesystem ──────────────────► output/
     ├── reports/
     ├── improvement-suggestions/
     ├── summary-*.md
     └── results-*.json
 │
 ▼
PO Review
 │
 ▼
Manual Adoption
 │
 ▼
GitHub Issue
```

Rationale:

- **Rules first, AI second.** Everything code can check reliably—such as story format, number of acceptance criteria, and epic links—runs deterministically in milliseconds. The model is used only for semantic questions, for example whether acceptance criteria are measurable. Every criterion is marked as `(deterministic)` or `(ai)` in the report.
- **Rules as data.** Criteria, points, and required flags are versioned in `references/criteria/*.json`. Teams can adjust them without changing code.
- **The Ready Gate overrides the score.** Required criteria determine whether an item is "Ready"; the score indicates progress. If a result is missing, for example because Ollama is unavailable, the criterion is treated as not passed (fail-closed).
- **Local AI through Ollama.** All AI calls go to the Ollama server at `OLLAMA_HOST` (default: this machine) with the model in `MODEL_NAME`. With a local host and a locally executed model, backlog contents are not sent to an LLM provider; a remote host or an Ollama cloud model would change that, and the demo reports it. Responses are returned as JSON according to a fixed schema, with `temperature: 0`, `top_k: 1`, and `seed: 42` to make results as consistent as possible on the same setup.
- **Improvement drafts through one-shot prompting.** For each issue type, the model receives a reference example from `references/quality/*.json`. No model weights are trained. The prompt asks for placeholders in square brackets instead of invented facts; issue numbers, percentages, ISO dates and quarters not present in the original are replaced automatically. Other invented details (for example message texts or scope slices) are not caught, which is why every draft goes through PO review. On the 2026-10-08 test day, drafts also copied content from the reference examples and, in one story, replaced existing context with placeholders (see `discovery/evidenz-2026-10-08.md`, German).
- **Pipeline instead of agent.** The model does not select tools. Behavior is reproducible and straightforward to debug.
- **No write access to GitHub.** Phrom is read-only; the code contains no function that writes to GitHub. The PO reviews every suggestion and applies it manually. The token requires only _Issues: Read-only_ for analysis.
- **Files as output.** Reports, drafts, and summaries are stored as Markdown and JSON in `output/`. This is traceable and versionable without additional infrastructure.

## Consequences

### Positive

- Assessments are explainable and traceable for every criterion.
- With a local Ollama host and model, backlog contents do not leave the local environment; Phrom reads the issues themselves through the GitHub REST API.
- The impact of errors is limited: Phrom cannot modify issues.
- Criteria can be adjusted without changing code.
- No cloud costs and no additional infrastructure.

### Negative / Risks

- **Model quality is not fully proven.** Whether a local model is sufficient for semantic checks such as `ac-testability`, `size-risk`, and `business-value` remains a hypothesis. Evaluation against a manually assessed test set is still incomplete.
- **Runtime.** Local inference is slow: on the CPU-only test system, the AI checks with `qwen3:30b-instruct` took 24.7–55.1 seconds per issue (measured 2026-10-08), and a `phrom run` over 19 issues a little over 12 minutes.
- **Heuristics.** Deterministic checks recognize patterns and keywords, not meaning. A text can pass without being good.
- **No resumption.** Individual AI calls are retried twice, but there is no per-issue status, retry of failed issues, or resume. If a run crashes, it starts over.
- **Manual step.** Applying suggestions takes time and is deliberately not automated.
- **Static references.** Improvement drafts use fixed reference JSON files rather than similarity search.

## Validation

The decision is considered validated when:

- a manually assessed test set shows that AI checks with the local model are sufficiently reliable,
- runs on the same setup yield reproducible results,
- an Ollama failure leads to a clear, traceable result (fail-closed) rather than false "Ready" outcomes.

## Open Questions

- **Model choice:** Whether a smaller model is significantly faster at comparable quality should be evaluated through a model comparison.
- **Failure status:** A dedicated `incomplete` status instead of fail-closed 🔴 is planned.
- **Batch processing and persistence:** Measuring time savings through batch processing and persistence in a database is planned.
- **Persistence:** PostgreSQL instead of files is a possible extension.
- **Workflow:** Status tracking, retry, resume, and a later evolution into an agent are deliberately outside this decision.
- **Write-back to GitHub:** Writing back to GitHub, for example as comments, would affect the guardrails and require a separate ADR.
