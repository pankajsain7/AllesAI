# Model configuration backup — 2026-08-28

This record preserves the model changes made during the live Groq/OpenCode audit.
It is intentionally a rollback map rather than a copy of any API keys or user settings.

## Verified live routes

- Groq: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`,
  `qwen/qwen3.6-27b`, `openai/gpt-oss-20b`, `groq/compound`, and
  `groq/compound-mini` returned successful minimal completion responses.
- OpenCode Zen: `hy3-free` and `nemotron-3-ultra-free` returned successful
  minimal completion responses.

## Removed/blocked routes

- Groq: `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` returned 404.
- OpenCode Zen: `deepseek-v4-flash-free` returned 400 and
  `muse-spark-1.2-contributor-free` returned 500.

## Rollback map

- Restore the two retired Llama default/catalog IDs only if Groq relists and
  successfully serves them.
- Remove `groq/compound`, `groq/compound-mini` from `MODEL_CATALOG` and
  `hy3-free` from `OPENCODE_KNOWN_MODELS` to undo the verified additions.
- Prior defaults were `openai/gpt-oss-120b`,
  `meta-llama/llama-4-scout-17b-16e-instruct`, `qwen/qwen3-32b`, and
  `gemini-2.5-flash-lite`; the previous consensus default was
  `gemini-2.5-flash-lite`.

No credentials, user-selected imported models, or provider settings are stored
in this backup.

## Council verification

The live council run completed its opening, critique, and convergence rounds.
Its first final-verdict request exceeded Groq's 8K request allowance, so the
final synthesis payload is now capped to a 10K-character response summary and
1.6K characters per note. The prior uncapped behaviour can be restored by
removing the `COUNCIL_SYNTHESIS_*` limits in `src/app/api/consensus/route.ts`.
