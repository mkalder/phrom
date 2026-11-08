# ADR-006: Switching the AI Backend from Local Ollama to a Self-Hosted LiteLLM Endpoint

- **Status:** Accepted (amends the "Local AI through Ollama" decision in ADR-003)
- **Date:** 2026-11-08
- **Decision-maker:** Marius Kalder (Product Owner / Author of Phrom)
- **Scope:** Replacing the direct Ollama client with an OpenAI-compatible client against a self-hosted LiteLLM endpoint

## Context

ADR-003 decided that all AI calls go directly to a locally run Ollama server through the `ollama` npm package, specifically so that backlog content does not leave the local machine and Phrom does not depend on a cloud LLM provider.

The author now routes model access through a self-hosted LiteLLM instance at a dedicated subdomain, `phorm.prodowner.de`, instead of talking to Ollama's native API directly. LiteLLM exposes an OpenAI-compatible interface (`/v1/chat/completions`, `/v1/models`) in front of one or more backend models, addressed from one maintained endpoint and configuration rather than a per-project Ollama host setting. This ADR records the resulting implementation change and, importantly, its effect on the privacy claim ADR-003 made.

## Decision Drivers

- **Protocol change is unavoidable:** LiteLLM's proxy speaks the OpenAI chat-completions format, not Ollama's native wire format (`/api/chat`, `/api/generate`). The `ollama` npm package cannot be pointed at it; the client has to be replaced, not reconfigured.
- **Minimal new dependency surface:** ADR-003's "no framework, no additional infrastructure" driver still applies. The actual surface needed — one JSON endpoint, optional SSE streaming — is small enough for Node's built-in `fetch`.
- **Honesty of the privacy claim:** `phorm.prodowner.de` is infrastructure the author operates, but it is still a remote host reached over the network from wherever Phrom runs. That is a materially different, weaker claim than "stays on the machine", and the documentation must say so precisely rather than keep the old wording.
- **Secret handling:** the repository is public on GitHub. `LITELLM_API_KEY` must only ever live in the gitignored `.env`, never in `.env.example` or committed code — the same convention already established for `GITHUB_TOKEN`.

## Options Considered

**Option A: Keep Ollama as the only backend.** Disadvantage: does not meet the author's decision to route model access through a self-hosted LiteLLM endpoint.

**Option B: Add the `openai` npm package and use its client against LiteLLM's OpenAI-compatible endpoint.** Advantages: a well-tested client that already handles retries, typing, and streaming edge cases. Disadvantages: a new dependency the project does not otherwise need; the request shape actually used here (chat completions, JSON-schema structured output, SSE streaming) is a thin enough slice that `fetch` covers it directly, the same reasoning that earlier favored Node's built-in test runner over Jest or Vitest.

**Option C: Implement a minimal OpenAI-compatible client with Node's built-in `fetch`, no new dependency.** Advantages: zero new dependency; consistent with the project's existing style. Disadvantages: Phrom now owns a small amount of HTTP/SSE-parsing code that a client library would otherwise provide, and it has to be tested deliberately rather than trusted to a maintained package.

## Decision

I choose **Option C: a minimal fetch-based client, `src/llm-client.js`, replacing `src/ollama-client.js`.**

- **New environment variables:** `LITELLM_HOST` (base URL, e.g. `https://phorm.prodowner.de`, no default — must be set), `LITELLM_API_KEY` (bearer token, secret, `.env` only, never in `.env.example`), `MODEL_NAME` (unchanged in name; now the model identifier as configured on the LiteLLM side, not necessarily an Ollama tag). `OLLAMA_HOST` and `OLLAMA_KEEP_ALIVE` are removed.
- **One endpoint for everything:** both `model.js`'s structured pass/fail/size checks and `model-improve.js`'s draft generation now go through a single `chatCompletion({ messages, format, options })` helper calling `POST {LITELLM_HOST}/v1/chat/completions`. This retires the Ollama-specific `chat` (messages) vs. `generate` (raw prompt) split — the OpenAI-compatible API has no such split, and `model-improve.js`'s prompt now goes through as a single user message, the same pattern every other check already used.
- **Structured output:** Ollama's `format: <json-schema>` becomes `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` for the pass/fail and size checks in `model.js`. `model-improve.js`'s looser `format: 'json'` mode becomes `response_format: { type: "json_object" }`. Plain-text generation sends no `response_format` at all.
- **Dropped per-request options with no OpenAI-API equivalent:** `top_k` (not part of the OpenAI chat-completions spec) and Ollama's `keep_alive` (a server-level setting; model unload behavior is now a LiteLLM/backend configuration concern, not something Phrom can set per request). `temperature` and `seed` are kept wherever they were used — both are part of the OpenAI-compatible schema.
- **`isCloudModel()` is removed.** It checked for Ollama's own cloud-model naming convention (`:cloud` / `-cloud` suffix), which has no meaning once the backend is LiteLLM. `describeAiEndpoint()` is simplified to a hostname-based local/remote signal only: `isLocal` is true only if the configured host resolves to this machine.
- **`package.json`:** the `ollama` dependency is removed.
- **`scripts/demo.js`'s preflight check** now calls `GET {LITELLM_HOST}/v1/models` (the OpenAI-compatible models-list endpoint) instead of Ollama's `/api/tags`, and labels a non-local endpoint generically rather than distinguishing an Ollama cloud model from any other remote host — that distinction no longer applies.

## Consequences

### Positive

- One unified client for every AI call (checks and draft generation), removing a split that only existed because of Ollama's own API shape.
- No new dependency: `fetch` is built into Node ≥18, and the project already requires Node ≥22.
- Model routing, and any future provider failover, are centralized in the author's own LiteLLM configuration instead of duplicated per project that uses it.

### Negative / Risks

- **The privacy claim changes, and this is the most important consequence of this ADR.** ADR-003 and the README/RULES documentation said backlog content "stays on the machine" when the host is local. `phorm.prodowner.de` is a remote host reached over the network, even though the author operates it; `describeAiEndpoint().isLocal` now correctly evaluates to `false` for this setup, and the demo/report stop calling this "local AI". README.md/.de.md and docs/RULES.en.md/.de.md are updated to say precisely what is and is not true now: content leaves the machine running Phrom and reaches infrastructure the author controls — a materially different and weaker claim than "stays on the machine". Anyone reading the documentation should not conflate "self-hosted" with "local".
- **Anyone else cloning the public repository loses the previous zero-setup local path.** Running Phrom against a local Ollama used to work by installing Ollama and setting `OLLAMA_HOST`. Now a clone needs some OpenAI-compatible endpoint it can reach — most simply, their own LiteLLM instance, which can itself point at their own local Ollama if they want the same "stays on my machine" property this project no longer claims for the author's own deployment.
- **Losing `top_k` as a tuning lever:** `top_k: 1` was part of how the prior setup minimized sampling variance for the deterministic-feeling checks. Whether `temperature: 0` and `seed` alone reproduce comparable determinism through LiteLLM and whatever model it routes to has not been measured.
- **Whether `response_format` with `strict: true` is honored end-to-end** (LiteLLM → the configured backend model) has not been verified by this change alone. A backend that ignores `strict` could return malformed JSON that the existing `JSON.parse(content)` call would throw on, surfacing as a thrown error rather than a clear configuration problem.
- **This change could not be verified against a live model from the environment that made it.** The sandboxed session that implemented this has no network path to `phorm.prodowner.de`, so `chatCompletion()` and the SSE parsing were verified against a local mock HTTP server simulating an OpenAI-compatible streaming response (plain text, `json_object`, and `json_schema` modes, plus the error path for a non-200 response and for a missing `LITELLM_HOST`), not against the real endpoint. `npm test` (76/76) and `node scripts/eval-seed.js` (18/18, exit 0) pass, but neither exercises the network path. A live run is still required (see Validation).

## Validation

The decision is considered validated when:

- `npm test` passes with the updated client (confirmed; does not require network for the unit tests themselves),
- a live `phrom run` or `phrom select` against the configured LiteLLM endpoint returns valid, schema-conforming JSON for each AI check without manual JSON-repair,
- `node scripts/eval-seed.js --ai` against the seed set produces results comparable to the previous Ollama-based run (same pass/fail pattern, allowing for ordinary model-judgment variance),
- `scripts/demo.js`'s preflight check correctly reports the LiteLLM endpoint and labels the run as non-local, since the host is remote.

## Open Questions

- Whether a `top_k`-equivalent control is available for the specific backend model(s) configured behind `phorm.prodowner.de`, and whether it is worth re-adding as an optional, backend-specific parameter.
- Whether Phrom should support a plain local-Ollama path again later (for example a `LLM_BACKEND=ollama|litellm` switch), for anyone cloning the public repository without access to the author's own LiteLLM instance. This ADR does not add that: it conflicts with the "minimal complexity" driver and no one has asked for it.
- Whether strict JSON-schema structured output is reliably honored by the model(s) configured behind `phorm.prodowner.de` remains to be confirmed empirically, against a live run.
