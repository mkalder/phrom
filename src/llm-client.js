/**
 * llm-client.js – Single client for all AI calls (checks, type inference, drafts).
 *
 * Talks to an OpenAI-compatible chat-completions endpoint, not Ollama's native API. In this
 * project's current setup, that endpoint is a self-hosted LiteLLM instance (see ADR-006); the
 * endpoint can equally be any other OpenAI-compatible server, including a LiteLLM instance that
 * itself routes to a local Ollama.
 *
 * Configuration through .env:
 *   LITELLM_HOST=https://your-litellm-host.example.com   (no default: must be set)
 *   LITELLM_API_KEY=...                                  (sent as "Authorization: Bearer ...")
 *   MODEL_NAME=qwen3:30b-instruct                        (model name as configured on that server)
 *
 * Why a dedicated module, and why fetch instead of a client package: the surface actually used
 * (one JSON endpoint, optional SSE streaming) is small, and ADR-003 already decided against
 * adding a framework or dependency for this. Node's built-in fetch covers it directly.
 */

export const LITELLM_HOST = process.env.LITELLM_HOST || "";
export const MODEL_NAME = process.env.MODEL_NAME || "qwen3:30b-instruct";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Hostname of LITELLM_HOST, or "" if it cannot be parsed. */
export function llmHostname(host = LITELLM_HOST) {
  try {
    return new URL(host).hostname;
  } catch {
    return "";
  }
}

/**
 * Where issue content goes when the AI runs.
 * isLocal = true only if the configured host resolves to this machine. A self-hosted endpoint the
 * author operates (for example a private LiteLLM instance) is still a remote host once content has
 * to cross the network to reach it, so it is reported as remote, not local.
 */
export function describeAiEndpoint(host = LITELLM_HOST, model = MODEL_NAME) {
  const hostname = llmHostname(host);
  const isLocal = LOCAL_HOSTNAMES.has(hostname);
  return { host, hostname, model, isLocal };
}

/**
 * chatCompletion({ messages, format, options }) – One call against POST {LITELLM_HOST}/v1/chat/completions.
 *
 * - messages: the OpenAI chat messages array.
 * - format: optional. A JSON schema object is sent as a strict `response_format` so the model must
 *   return an object matching that schema (used by the pass/fail and size checks in model.js). The
 *   string "json" is sent as the looser `{ type: "json_object" }` mode, which only guarantees valid
 *   JSON without enforcing a schema (used by model-improve.js's draft generation). Omitted entirely
 *   for plain-text generation.
 * - options: sampling parameters merged into the request body as-is (e.g. { temperature, seed } or
 *   { temperature, top_p }). Ollama's `top_k` and `keep_alive` have no equivalent in the
 *   OpenAI-compatible API and are intentionally not supported here; see ADR-006.
 * - Always requests a stream: a non-streaming call only returns response headers once the whole
 *   answer exists, and Node's fetch (undici) aborts after 5 minutes without headers, which a slow
 *   or cold-starting backend model can exceed. A stream starts delivering immediately.
 */
async function chatCompletion({ messages, format, options = {} }) {
  if (!LITELLM_HOST) {
    throw new Error("LITELLM_HOST must be set in .env");
  }

  const body = {
    model: MODEL_NAME,
    messages,
    stream: true,
    ...options,
  };
  if (format === "json") {
    body.response_format = { type: "json_object" };
  } else if (format) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "phrom_check", schema: format, strict: true },
    };
  }

  const res = await fetch(`${LITELLM_HOST}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LITELLM_API_KEY ? { Authorization: `Bearer ${process.env.LITELLM_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`LiteLLM request failed: ${res.status} ${res.statusText}${text ? ` – ${text}` : ""}`);
  }

  return readSseContent(res.body);
}

/**
 * readSseContent(body) – Reads an OpenAI-style SSE stream ("data: {...}\n\n", ending in
 * "data: [DONE]") and concatenates every chunk's delta content into the full response text.
 */
async function readSseContent(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) continue;

      const data = line.slice("data:".length).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        content += parsed.choices?.[0]?.delta?.content ?? "";
      } catch {
        // Ignore malformed SSE lines rather than aborting a partial response.
      }
    }
  }

  return content;
}

export { chatCompletion };
