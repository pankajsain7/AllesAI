# Changelog

This file is maintained by the agent. After every task that changes code, config, or project files, append a new entry at the top.

## Entry format

```
## [YYYY-MM-DD] <short title>
**Changed:** <what files/components were touched>
**Why:** <what the task was>
**Summary:** <what was actually done in 1-3 sentences>
```

---

## [2026-09-02] Require pull-request workflow for all Git publishing
**Changed:** `instructions/commit-rules.md`
**Why:** User asked for every Git publish request to use a feature branch, pull request, and merge, authenticated as `pankajsain7` with the configured PAT.
**Summary:** The repository rules now require branch creation, a scoped verified commit, PAT-authenticated push as `pankajsain7`, PR creation to `main`, and merge after checks pass. The PAT must be sourced without ever appearing in output, history, or Git content; a missing required scope must be reported rather than bypassed with another account.

## [2026-09-02] Consensus/council quality: budgeting, judging, routing and failure handling
**Changed:** `src/app/api/consensus/route.ts`, `src/lib/answer-budget.ts` (new), `scripts/check-budget.mjs` (new), `package.json`
**Why:** Audit of the consensus/council pipeline for answer quality. Found several defects that silently degraded every run rather than surfacing as errors.
**Summary:**
*Budgeting* — `formatResponseBlock` re-truncated responses the caller had already budgeted, capping every path at the 280k default and making the Pro (400k) and Ultra (600k) context tiers do nothing. Truncation now happens exactly once, in a new `lib/answer-budget.ts`: budgets are derived from the target model's own context window (so a small-window judge is not handed a payload it can only reject), allocation is water-filled (short answers keep their full text and their slack is redistributed to long ones instead of a flat `budget / n` split), and over-long answers keep head *and* tail rather than a head-only slice that discarded the conclusion. Covered by `npm run check:budget` (18 assertions).
*Judging* — non-streaming calls were capped at 1200 output tokens, so a full-panel scorecard was truncated mid-JSON, failed to parse, and was dropped entirely; caps are now per-role (judge 4096, council note 2048). Judges also invented their own candidate names, and `mergeJudgeResults` keyed on that raw string, so "GPT" vs "GPT-OSS" split one candidate into two half-sampled rows and split the winner vote — the prompt now enumerates the exact roster names and `parseJudge` maps every returned name back onto it.
*Routing/failures* — added a per-run provider circuit breaker (WeakMap keyed on the request body) so a revoked key trips once instead of being rediscovered on every bench model at a full timeout each. `streamTextEvents` now holds the first 200 chars before committing, so a model that dies after a few tokens is replaced by a fallback instead of leaving an unretractable stub. Council notes get a 25s timeout (down from 45s) since they are short. If every moderator fails, the council now returns the closing positions instead of discarding a completed 12-note debate behind an error card.
*Prompts* — model-name rules now list the actual aliases in the run rather than a hardcoded roster snapshot; debaters get a brief temporal grounding instead of the full evidence-weighting briefing (injected into ~20 calls per run); a debater promoted to moderator no longer gets a prompt asserting "you did not debate"; a replacement debater joining at Rebuttal gets the opening brief instead of "defend the claims you were critiqued on" for claims it never made; removed the dead `webSearch ? "" : ""` ternary and the "Start with `<alias>:`" instruction that `stripModelPrefix` immediately deleted.
Verified with `npx tsc --noEmit`, `npm run build`, and every offline `check:*` script.

## [2026-09-02] Heartbeat the whole consensus run, not just the verdict stage
**Changed:** `src/app/api/consensus/route.ts`
**Why:** Council reached 12 debate notes (Pro: 3 debaters × 4 rounds) and then failed with "No response after 60s". The heartbeat only started after the last debate round, so every silent gap *inside* the debate — `Promise.allSettled` waiting on the slowest debater (up to 45s), a transient-retry (+1.5s +45s), and the sequential fallback-replacement calls that follow a failed debater — sent zero bytes and could exceed the client's 60s stall watchdog, aborting a run that was still healthy.
**Summary:** Moved `startHeartbeat` into `createNdjsonResponse` so every consensus/council response emits a `ping` every 12s for its entire lifetime, and removed the per-phase heartbeats from `runSingle` and `runCouncil` (dropping their now-redundant try/finally wrappers). The heartbeat is stopped in the response's `finally` before `done`/`close`, so no ping can be enqueued after the stream closes. Server-side timeouts (45s non-streaming, 40s first-token/idle) still bound a genuinely stalled upstream. Verified with `npx tsc --noEmit` and `npm run check:consensus`.

## [2026-09-01] Bump version to 2.0.0 for the v2.0.0 release
**Changed:** `package.json`
**Why:** User asked to launch a v2.0.0 GitHub release. Since v1.0.0, the app gained Amazon Bedrock as its primary provider (Gemini removed), a consensus/council planner with a verified backup bench, SSRF hardening, custom OpenAI-compatible providers, and numerous UX fixes.
**Summary:** Bumped `package.json` version from `0.1.0` to `2.0.0` to match the tag. The GitHub repo's About section was also updated separately, and tag `v2.0.0` + a GitHub release were published from this commit.

## [2026-09-01] Rewrite README for the Bedrock-first provider lineup
**Changed:** `README.md`
**Why:** User asked to update the README to reflect the current API providers and highlight Amazon Bedrock. The doc still described the pre-Bedrock, Gemini-era stack (Gemini env var, `/api/gemini/models` route, Gemini in the tech stack/architecture diagram) even though Gemini was removed and Bedrock became the primary provider on 2026-08-31.
**Summary:** Added a top-level "API Providers" table (Bedrock/Groq primary, Ollama Cloud/OpenCode backup, Local/Custom optional) and expanded the Bedrock row in "Live Models" with its importable roster and "no AWS console setup" callout. Removed every stale Gemini reference: tech stack, `.env.local` template, "where to get keys" table, architecture diagram, API routes table (dropped `/api/gemini/models`, added a note that Bedrock's browse list is a pre-qualified roster rather than a live proxy), and project structure tree. Added a Bedrock bullet to the Models & Providers feature list. Verified with `npm run build`.

## [2026-09-01] Pointer cursor on the clickable logo
**Changed:** `src/components/Logo.tsx`
**Why:** User asked for a hand/pointer cursor on hover over the clickable Alles AI logo.
**Summary:** Added `cursor-pointer` to the logo's button wrapper.

## [2026-09-01] Logo click starts a new chat (home screen)
**Changed:** `src/components/Logo.tsx`, `src/components/Sidebar.tsx`, `src/app/page.tsx`
**Why:** User asked for clicking the Alles AI logo to open the home screen / new chat, matching common app conventions.
**Summary:** `Logo` now accepts an optional `onClick` and renders as a button when provided. Both the sidebar logo (desktop) and the header logo (mobile) call `newConversation()` on click, same as the existing "New chat" button.

## [2026-09-01] Merge new Bedrock defaults into already-persisted model lists
**Changed:** `src/lib/store.ts`, `scripts/check-bedrock-toggle.mjs`
**Why:** A second machine's Settings showed only 3 imported Bedrock models (missing Ministral 14B) while this browser showed all 4. Settings persist at a fixed version; `migrate()` only ran `bedrockModels ?? DEFAULT_BEDROCK_MODEL_IDS`, so once a user's `bedrockModels` array was persisted (with only 3 ids, from before Ministral was added to the roster), it was never re-filled with defaults added later.
**Summary:** Bumped settings persistence to version 12 and changed the migration to union the persisted `bedrockModels` with the current `DEFAULT_BEDROCK_MODEL_IDS` instead of only defaulting when unset, so newly-added roster models reach existing users while any extra imported models are kept. Added a regression scenario (v11 state missing Ministral) confirming it's added on migrate without dropping prior imports.

## [2026-09-01] Fix browser-stored Bedrock credentials in multi-chat
**Changed:** `src/app/api/chat/multi/route.ts`, `src/app/api/chat/route.ts`, `src/app/api/consensus/route.ts`, `src/lib/chat-client.ts`, `scripts/check-client-key-forwarding.mjs`
**Why:** Normal chat sent browser credentials to `/api/chat/multi`, but the fan-out route omitted the Bedrock key from its internal `/api/chat` requests. Retrying failures also accumulated empty assistant records that could produce empty Ministral completions.
**Summary:** Multi-chat now forwards `bedrockApiKey` to every internal request, and all Bedrock routes consistently trim browser or environment credentials. API message serialization omits empty history records while retaining failed cards in the UI. The regression check covers direct calls, router calls, multi-chat fan-out, and repeated retries.

## [2026-08-31] Add Amazon Bedrock provider and remove Gemini entirely
**Changed:** `src/lib/providers.ts`, `src/lib/models.ts`, `src/lib/model-rules.ts`, `src/lib/consensus-plan.ts`, `src/lib/store.ts`, `src/lib/chat-client.ts`, `src/app/api/chat/route.ts`, `src/app/api/chat/multi/route.ts`, `src/app/api/consensus/route.ts`, `src/app/api/gemini/` (deleted), `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/*`, `scripts/*`, `README.md`
**Why:** User asked to add Amazon Bedrock with GLM 4.7 Flash, Kimi K2.5, DeepSeek V3.2 and Ministral 14B, verify models can summarise ten long answers, confirm chat and conversation context work, then remove Gemini completely.
**Summary:** Added Bedrock via the project-scoped mantle endpoint (`bedrock-mantle.us-east-1.api.aws`, path `/v1/chat/completions`, `x-api-key` auth) as a first-class provider with settings UI, chat and consensus routing, catalog entries and store persistence (settings version 11). All four requested models verified live: they stream, answer in 0.4-0.6s to first token, and digest an ~82k-char / 20.5k-token payload representing consensus over ten long model answers. Five more qualified Bedrock models are importable. Diagnosing the key cost some time and is worth recording: the original value was truncated at both ends (missing the leading `A` and trailing `=`), and the classic `bedrock-runtime.amazonaws.com` host accepts such a key for read-only calls while returning a misleading `Operation not allowed` for every invoke — the mantle endpoint is the correct target. Then removed Gemini completely: provider key, settings, store fields, both API route branches, the `/api/gemini/models` route, `toGeminiBody`, stream parsing, UI panels and status pill, and all test-script references. Retired Gemini ids are aliased to empty so persisted selections are scrubbed on load. The `gemini` *ProviderKey* is deliberately kept — it is the Google brand used by Gemma models on Ollama Cloud. Provider priority is now Bedrock → Groq → Ollama → OpenCode → Local, and `DEFAULT_SELECTED_MODELS`/`CONSENSUS_MODEL` point at Bedrock. Also bounded the fallback benches to 8 models; they previously grew with the pool, exceeding the request validation cap and meaning a failing run could walk through seventeen upstream timeouts. Verified with `tsc --noEmit`, zero eslint errors, a successful `next build` (no Gemini route in the table), 8/8 chat models passing single-turn, multi-turn context and 10-turn recall, and consensus/council/fault-injection/input-validation all green. Consensus end to end went from 7.6s to 4.7s.

## [2026-08-31] Production-readiness audit: SSRF fix, catalog dedupe, hook crash, streaming latency
**Changed:** `src/lib/ssrf.ts` (new), `src/app/api/chat/route.ts`, `src/app/api/consensus/route.ts`, `src/app/api/ollama/models/route.ts`, `src/app/api/custom/models/route.ts`, `src/lib/models.ts`, `src/lib/model-rules.ts`, `src/lib/consensus-plan.ts`, `src/lib/store.ts`, `src/components/HeroComposer.tsx`, `src/components/Composer.tsx`, `src/components/ModelColumn.tsx`, `scripts/*`, `README.md`, `package.json`, `.gitignore`
**Why:** User asked for a full end-to-end audit before a production push: test every model and feature, review the previous agent's work, verify consensus/council logic and error handling, find better free models, remove retired ones, and deduplicate same-family models from the same provider.
**Summary:** Swept all 121 models across four providers with live requests. **Security:** the BYOK proxy fetched any client-supplied base URL with only a scheme check, so a deployed instance could be used to reach cloud metadata (169.254.169.254), loopback and internal ranges — added `lib/ssrf.ts` with DNS resolution and private-range blocking, allowing local Ollama in dev or via `ALLOW_PRIVATE_NETWORK_UPSTREAM=true`; added request size/array caps to stop unbounded upstream fan-out; added `runtime`/`maxDuration` so streaming and 60s+ council runs survive serverless defaults; routed `custom/` ids explicitly instead of letting them fall through to Groq. **Catalog:** deduped to one model per family per provider (dropped `qwen/qwen3.6-27b`, `gemma-4-26b-a4b-it`, older flash-lite generations, Ollama `gpt-oss:20b`/`nemotron-3-nano`/`nemotron-3-ultra`), added newly verified free `gemma-4-31b-it`, and kept OpenCode free models backup-only after confirming an account-wide 429 usage cap. **Correctness:** fixed a conditional `useMemo` in HeroComposer that changed hook order when a conversation was deleted. **Performance:** roster latencies had been measured non-streaming, but everything streams — `gemini-3.6-flash` answers in 1.4s non-streaming yet takes 4.6–9.8s to first streamed token, so it was auto-selected as synthesizer and tripped the 40s stall watchdog; re-measured against the streaming endpoint and consensus went from 43s to 7.6s. Also corrected a false security alarm from the prior session: the repo's git lives in `app/`, not the workspace root, and the "unauthorized" edits were prior commits `d37faab`/`73d89ba`. Verified with `tsc --noEmit`, zero eslint errors, a successful `next build`, and live consensus/council/fault-injection/input-validation runs.

## [2026-08-29] Rebuild consensus/council model selection as an API-key-aware plan with a verified backup bench
**Changed:** `src/lib/consensus-plan.ts` (new), `src/lib/model-rules.ts`, `src/lib/models.ts`, `src/lib/store.ts`, `src/components/ConsensusButton.tsx`, `src/app/api/consensus/route.ts`, `scripts/check-models.mjs` (new), `scripts/check-consensus.mjs` (new), `package.json`, `README.md`
**Why:** User asked to add new models, then make consensus/council aware of which API keys are provided, pick the best models per role, handle models that stop working, define real backup models, and document + test the whole workflow.
**Summary:** Probed every provider live and updated the catalog: removed `hy3-free` (now 401 "not supported") and `nemotron-3.5-lightning-free` (never returns, >60s timeout), added OpenCode `ling-3.0-flash-fin-free` and `laguna-s-2.1-free`; dropped Ollama Cloud `minimax-m3` (402, paid-only) from the default presets and added the free-tier-verified `nemotron-3-super`, `gpt-oss:120b`, `gpt-oss:20b`, `nemotron-3-nano:30b`; seeded `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` as default Gemini imports so a Gemini-only user has a backup bench. Replaced the hard-coded 6-id consensus allowlist with `CONSENSUS_MODEL_ROSTER`, a verified tier (`primary`/`backup`) + measured-latency table, and opened consensus/council to OpenCode Zen models so an OpenCode-only user is no longer locked out. Added `planConsensusRun()` as the single source of truth: it reads which keys are present, collects eligible models, ranks them (tier → latency → context), assigns synthesizer/debaters/judges with provider diversity (judges kept off the debate floor), and builds a provider-interleaved backup bench so one revoked key or rate limit cannot wipe out every fallback. `ConsensusButton` now consumes that plan instead of four separate ad-hoc selection blocks, and surfaces the plan's blocker text ("Add an API key for X") instead of generic messages. Backend now retries transient upstream errors (429/502/503/504) once before falling to the bench, but never retries a model that already streamed text. Added `npm run check:models`, `check:consensus`, and `check:consensus:live`; all planner checks pass across 7 key combinations, and live single/council runs plus fault injection (dead model, bad key) recover via the bench. Verified with `tsc --noEmit` and eslint.

## [2026-07-07] Add fullscreen toggle to Results panel
**Changed:** `src/components/SharedResultsLane.tsx`
**Why:** User requested the same double-arrow fullscreen control in the Results popup header (near Close), not just in the Model Council modal.
**Summary:** Added a header button that toggles the Results panel between anchored popup mode and fullscreen mode, using maximize/minimize (double-arrow) icons. The content area now expands to full height in fullscreen, and close resets fullscreen before closing.

## [2026-07-07] Simplify council output and add fullscreen modal control
**Changed:** `src/components/SharedResultsLane.tsx`, `src/components/ConsensusButton.tsx`
**Why:** User requested a cleaner council view: show only the final verdict in the main panel, move model/scorecard details under "How it decided", and add a fullscreen toggle near the modal close button.
**Summary:** Council cards now render only the final verdict section in the primary answer area and hide scorecard/model metadata from that surface. "How it decided" now contains quality snapshot details (including judge scorecard) plus an expandable full verdict report. Added a header control next to close to toggle fullscreen/exit-fullscreen for the Model Council modal.

## [2026-07-07] Fix Model council failing at the verdict stage
**Changed:** `src/app/api/consensus/route.ts`, `src/components/ConsensusButton.tsx`
**Why:** Council produced all debate notes and the judge scorecard, then failed with "No response after 60s". The gap between the last council note and the synthesizer's first token (server-side non-streaming judge scoring + waiting for the verdict's first token) sent no bytes, so the client's connection watchdog aborted the whole request — which also killed the server's moderator fallback chain before it could try another model.
**Summary:** Added a server-side stall watchdog to `streamTextEvents` (aborts a synthesizer that yields no first token within `STREAM_FIRST_TOKEN_TIMEOUT_MS`, or goes idle mid-stream, so the caller falls back itself) and made it return `{ emitted }` so partial answers aren't duplicated by a fallback. Added `startHeartbeat`/`{type:"ping"}` events emitted every `HEARTBEAT_INTERVAL_MS` around the judge + synthesis phase in both `runCouncil` and `runSingle` so the client watchdog sees liveness while the server works through fallbacks. `openStreamingUpstream`/`pipeStreamingText` now accept a signal / `onDelta` callback. Client recognises the `ping` event (each read already resets its watchdog). Verified with `tsc --noEmit`.


**Changed:** `src/lib/model-rules.ts`, `src/lib/models.ts`, `src/lib/providers.ts`, `src/components/ProviderIcon.tsx`, `src/components/ConsensusButton.tsx`
**Why:** `ollama-cloud/cogito-2.1:671b` returned HTTP 410 (retired). All references must be removed so it no longer appears in priority lists or gets resolved.
**Summary:** Removed `cogito` from `CONSENSUS_PRIORITY_MODEL_IDS`, `COUNCIL_PRIMARY_MODEL_IDS`, and `JUDGE_MODEL_IDS` in `model-rules.ts`; removed the cogito alias in `getModelAlias`; removed the `cogito` dynamic model generator block in `models.ts`; removed `"cogito"` from the `ProviderKey` union type, `PROVIDERS` record, and `PROVIDER_ORDER` in `providers.ts`; removed the `cogito: "CG"` monogram entry in `ProviderIcon.tsx`; removed the cogito-specific local-model name mapping in `ConsensusButton.tsx:findLocalModelName`. Verified with `tsc --noEmit`.

## [2026-07-06] Fix stop buttons not working when prompt sent from hero page
**Changed:** `src/lib/chat-client.ts`, `src/components/Composer.tsx`
**Why:** Stop button showed but did nothing — `HeroComposer` discarded the `AbortController` returned by `sendPromptToAll`, so `Composer`'s `ctrlRef` was never set.
**Summary:** Added a module-level `sessionAbortController` in `chat-client.ts` that `sendPromptToAll` always populates. Exported `abortAllStreams()` so any component can abort the current session. `Composer.onStop` now calls `abortAllStreams()` instead of a local ref, and `Composer.onSubmit` no longer saves to the removed `ctrlRef`. `HeroComposer` needs no change — `sendPromptToAll` saves the controller automatically.

## [2026-07-06] Auto-pick consensus synthesizer by context window, remove manual model selector
**Changed:** `src/components/ConsensusButton.tsx`
**Why:** User wanted the consensus model dropdown removed; instead automatically use the top 2 available large-context models (e.g. Gemma 4 + Gemini 2.5) as the synthesizer chain, judged via the existing LLM-as-judge stage, with 1 model being sufficient if only one is available.
**Summary:** `consensusChoices` is now sorted by `model.context` descending (largest context window first) instead of following a fixed priority order; `synthesizerChoices` takes the top 2 as the primary + fallback synthesizer, no longer reading/writing the user's `consensusModel` setting. Replaced the `<select>` dropdown in the consensus/council modal with a static badge row showing the auto-picked primary and fallback model(s). Verified with `next build`.

## [2026-07-06] Add LLM-as-judge, stronger consensus/council prompts, and robust fallback
**Changed:** `src/app/api/consensus/route.ts`, `src/lib/model-rules.ts`, `src/lib/store.ts`, `src/components/ConsensusButton.tsx`, `src/components/SharedResultsLane.tsx`
**Why:** Improve consensus/council answer quality — add a dedicated judge, sharpen prompting, size the panels sensibly (consensus 2-3, council 4-5), and degrade gracefully when the user has few or no API keys.
**Summary:** Added a dedicated LLM-as-judge stage that scores each panel answer as strict JSON (accuracy/relevance/completeness/clarity/citations, overall, winner, confidence) with graceful non-fatal fallback and prose-scorecard backup; the judge scorecard now streams via a new `judge` NDJSON event, is stored on `SharedResult.judge`, and renders as a table in both consensus and council results. Rewrote the synthesizer, council member, moderator, and round prompts to be sharper and evidence-first, and added a single-source self-review synthesizer for solo runs. Council now seats the user's own answering models first (then backfills from the priority bench, capped at 5) so it works with whatever keys are present; consensus now allows a solo run with one answer; the judge prefers a non-panel model; and empty-state messages point users to add a provider key. Verified with `next build`.

## [2026-07-06] Enforce ponytail-first workflow for all agent tasks
**Changed:** `AGENTS.md`, `.github/copilot-instructions.md`, `instructions/agent-behavior.md`
**Why:** User requested ponytail lazy-code skill to be applied every time before writing code or making implementation decisions.
**Summary:** Added mandatory ponytail-first directives in both instruction entry points and the core behavior rules. The agent now treats ponytail as required for each task, defaults to full intensity, and follows a strict simplify-first order before any implementation work.

## [2026-07-06] Fix OpenCode model toggle bug; extend browse/import to Groq and Gemini; declutter picker
**Changed:** `src/lib/store.ts`, `src/lib/models.ts`, `src/components/SettingsDialog.tsx`, `src/components/ModelPicker.tsx`, `src/components/SingleModelPicker.tsx`, `src/app/api/groq/models/route.ts` (new), `src/app/api/gemini/models/route.ts` (new)
**Why:** Toggling any OpenCode model (e.g. DeepSeek V4 Flash Free) on did nothing because `normalizeModelId` didn't recognize `opencode/` ids and silently dropped them from `selectedModels`. The user also asked to browse/import models for all API providers, surface free models first, and keep the picker uncluttered.
**Summary:** Fixed `normalizeModelId` to accept `opencode/`, `groq/`, and bare `gemini*` ids instead of validating only against the old static catalog. Added `getGroqExtraModelInfo(s)`/`getGeminiExtraModelInfo(s)` (generic id-based fallback, brand-guessed icons) plus `groqExtraModels`/`geminiExtraModels` persisted settings (v8 migration) and new `GET /api/groq/models` / `GET /api/gemini/models` proxies, so Groq and Gemini now get the same "Browse models" checklist as OpenCode/custom providers. Refactored the browse-panel state into a shared `useModelBrowser` hook, added a free/paid sort + "Free" badge to `ModelBrowsePanel` and to each `ModelFamilyRow` in the picker, and made `compareFamilies` sort free families ahead of paid ones everywhere so free options always surface first without manual grouping.


## [2026-07-06] Browse and import models from OpenCode Zen and custom providers
**Changed:** `src/lib/models.ts`, `src/lib/store.ts`, `src/components/SettingsDialog.tsx`, `src/components/ModelPicker.tsx`, `src/components/SingleModelPicker.tsx`, `src/app/api/opencode/models/route.ts` (new), `src/app/api/custom/models/route.ts` (new)
**Why:** OpenCode Zen only shipped 5 hardcoded free models and custom OpenAI-compatible providers required manually typing model IDs; the user wanted to see the full list of models an API key/provider offers and pick which ones to import.
**Summary:** OpenCode models are now generated dynamically from a user-selected `opencodeModels` list (persisted, defaults to the previous 5 free models) instead of a fixed catalog; unknown ids get a generic label. Added `GET /api/opencode/models` (proxies `https://opencode.ai/zen/v1/models`) and `GET /api/custom/models` (proxies `<baseUrl>/models` for any OpenAI-compatible provider). Added a shared `ModelBrowsePanel` checklist UI (with filter) in `SettingsDialog.tsx`, wired to a "Browse models" button for both the OpenCode section and each custom provider editor, so users can fetch the live model list and check which ones to enable. Bumped settings persist to v7 for the new field.


## [2026-07-06] Finish OpenCode Zen provider integration (plan item 1)
**Changed:** `src/lib/providers.ts`, `src/lib/models.ts`, `src/lib/store.ts`, `src/lib/model-rules.ts`, `src/lib/chat-client.ts`, `src/app/api/chat/route.ts`, `src/components/ProviderIcon.tsx`, `src/components/SettingsDialog.tsx`, `src/components/ModelPicker.tsx`, `src/components/SingleModelPicker.tsx`, `src/components/Composer.tsx`, `src/components/HeroComposer.tsx`, `src/app/page.tsx`
**Why:** `src/app/api/consensus/route.ts` and `ConsensusButton.tsx` already referenced OpenCode (`opencodeApiKey`/`opencodeEnabled`) but the rest of the app (provider catalog, settings store, chat route, pickers, UI) never defined them, so the project failed to type-check.
**Summary:** Added `opencode` as a real `ProviderKey`/`ApiProviderKey`, added the 4 free OpenCode Zen models (Big Pickle, DeepSeek V4 Flash Free, MiMo 2.5 Free, Nemotron 3 Ultra Free) to the model catalog, added `opencodeApiKey`/`opencodeEnabled` to the settings store (persist v6 migration), added OpenCode access checks to `model-rules.ts`, added a streaming `opencode/` route in `/api/chat` (mirrors the consensus route's Zen gateway call), wired the API key through `chat-client.ts`, added a Settings toggle + key input, and included OpenCode in `ModelPicker`/`SingleModelPicker`/`Composer`/`HeroComposer`/`page.tsx` enabled-provider plumbing. Verified with `tsc --noEmit`, `next lint`, and `next build`.


## [2026-06-30] Use delimiter in prompt to split answer from analysis
**Changed:** `src/app/api/consensus/route.ts`, `src/components/SharedResultsLane.tsx`
**Why:** Section parsing via regex was fragile — the model output didn't match expected format, hiding the answer and showing broken content. Needed a reliable way to separate the answer from the analysis sections.
**Summary:** Changed DEEP_SECTIONS/QUICK_SECTIONS prompts to output the answer first, then a `---` delimiter, then analysis sections. `ConsensusResult` now splits at `\n---\n` to show the answer as main content and the analysis sections inside the expandable details. Fallback: if no delimiter found, full content is shown as the answer.

## [2026-06-30] Fix consensus: answer first, analysis in expandable details
**Changed:** `src/components/SharedResultsLane.tsx`, `src/app/api/consensus/route.ts`
**Why:** User wanted the consensus answer clean by default but with access to the full quality analysis (claim checks, conflicts, quality scorecard, etc.) when needed.
**Summary:** Restored DEEP_SECTIONS prompt so the model outputs all analysis sections. In ConsensusResult, split the content: "Best answer" section renders as the main answer; remaining sections (Why this is best, Claim checks, Agreement, Disagreement, Confidence, Quality scorecard, etc.) go into a collapsible "Show analysis details" section below.

## [2026-06-30] Pass web search flag to consensus so it weights web-sourced claims
**Changed:** `src/app/api/consensus/route.ts`, `src/components/ConsensusButton.tsx`
**Why:** When only one model uses Tavily web context correctly and others disagree, consensus dismissed the correct info. The synthesis model had no way to know web search was active.
**Summary:** Added `webSearch` flag from settings to the consensus request body. `formatResponseBlock` now includes a preamble noting web search was active. `temporalGrounding` tells the synthesis model to weight responses with specific web-sourced details over unsourced assertions. Added `webSearch` setting access in ConsensusButton.

## [2026-06-30] Remove "Deep" label and meta sections from consensus UI
**Changed:** `src/components/ConsensusButton.tsx`, `src/components/SharedResultsLane.tsx`, `src/app/api/consensus/route.ts`
**Why:** User wanted a clean answer-only display — no "Deep consensus answer" title, no meta-analysis sections (Best answer, Why this is best, Claim checks, Quality scorecard, etc.) in the output.
**Summary:** Changed modal title from "Deep consensus answer" to "Consensus answer". Simplified DEEP/QUICK_SECTIONS prompts to output only the answer without meta sections. Removed qualityMode badge from QualitySnapshot. Internally the deep analysis still runs.

## [2026-06-30] Fix consensus rejecting correct Tavily results as hallucination
**Changed:** `src/app/api/consensus/route.ts`
**Why:** The temporalGrounding() instruction told the synthesis model "Agreement alone is not proof", causing it to dismiss consistent web-sourced claims (e.g., Daveigh Chase's death via Tavily) as hallucinations in favor of its outdated training data.
**Summary:** Replaced "Agreement alone is not proof" with instruction to trust multi-model agreement on breaking-news facts as meaningful corroboration. Explicitly states synthesis model's knowledge cutoff may predate live Tavily results.

## [2026-06-30] Ground consensus in the runtime date
**Changed:** `src/app/api/consensus/route.ts`
**Why:** Prevent consensus and council models from rejecting current news as fictional because their training cutoff predates the runtime date.
**Summary:** Added an authoritative runtime-date instruction to every consensus and council prompt. The judge now prioritizes cited live-web evidence over unsupported model-memory objections while remaining explicit that it cannot independently verify supplied citations.

## [2026-06-30] Remove regenerate-answer icon
**Changed:** `src/components/ModelColumn.tsx`
**Why:** Remove the regenerate-answer action from each model header.
**Summary:** Removed the regenerate icon button while retaining retry behavior for failed responses.

## [2026-06-30] Live web browsing for all models + auto web search
**Changed:** `src/app/api/chat/route.ts`, `src/lib/chat-client.ts`, `src/app/api/search/route.ts`, `src/components/SettingsDialog.tsx`
**Why:** Reduce reliance on Tavily/Gemini for fresh answers, let the agent decide when to search, and give every model real "browse and extract" web content (OpenCode-CLI style) without depending on Gemini's small quota.
**Summary:** Gemini now browses live via its native Google Search grounding tool when web search is active, while non-Gemini models (Groq, OpenCode, Ollama) use Tavily with deepened page-content extraction (top results carry near-full page text instead of short snippets). Web search now auto-enables for time-sensitive prompts even when the toggle is off, failing soft to model knowledge unless the user explicitly requested it; a retrieval failure no longer blocks Gemini.

## [2026-06-30] Add OpenCode Zen API provider
**Changed:** `src/lib/providers.ts`, `src/lib/models.ts`, `src/lib/store.ts`, `src/lib/model-rules.ts`, `src/lib/chat-client.ts`, `src/app/api/chat/route.ts`, `src/app/api/consensus/route.ts`, `src/components/ProviderIcon.tsx`, `src/components/SettingsDialog.tsx`, `src/components/ModelPicker.tsx`, `src/components/SingleModelPicker.tsx`, `src/components/ConsensusButton.tsx`, `src/app/page.tsx`, `src/components/Composer.tsx`, `src/components/HeroComposer.tsx`
**Why:** Add OpenCode Zen as a new free OpenAI-compatible API provider.
**Summary:** Wired OpenCode Zen end-to-end (provider metadata, settings toggle + API key, model catalog with 5 free models, chat/consensus routing via the `opencode/` prefix to the Zen gateway, picker source pill, and provider icon). Key resolves from settings or `OpenCode_API_Key`/`OPENCODE_API_KEY` env, with a persisted-store migration to v6.

## [2026-06-30] Add pre-push env secret check
**Changed:** `instructions/commit-rules.md`, `instructions/changelog.md`
**Why:** Make secret handling explicit before any git push.
**Summary:** Added a mandatory pre-push check for `.env*` files so secrets, API keys, and tokens are verified as local-only before pushing. Recorded the instruction update in the changelog.

## [2026-05-14] Fix duplicate score key collisions
**Changed:** `src/components/SharedResultsLane.tsx`
**Why:** Address PR review feedback about potentially colliding React keys in the quality score badges.
**Summary:** Updated score badge rendering to include the array index in the key string, preventing collisions when duplicate label/value pairs appear in the scorecard.

## [2026-05-12] Improve consensus and council quality
**Changed:** `src/app/api/consensus/route.ts`, `src/components/ConsensusButton.tsx`, `src/components/SharedResultsLane.tsx`, `src/lib/store.ts`, `src/lib/models.ts`, `README.md`
**Why:** Make consensus/council more useful by adding quality modes, better council moderation, clearer UX access, and current documentation.
**Summary:** Added quick/deep synthesis prompts with a quality rubric, dedicated council moderator routing, separate Consensus and Council actions, and stored confidence/score metadata. Updated the default synthesis model and README wording to match the current eligible-model behavior.

## [2026-05-12] Prepare remaining local changes for push
**Changed:** `AGENTS.md`, `instructions/commit-rules.md`, `src/app/page.tsx`
**Why:** Publish the remaining local changes without committing secret details or whitespace-only noise.
**Summary:** Replaced a PAT-specific note with a general secret-handling rule, corrected the feature-branch push rule wording, and removed trailing whitespace from the page entrypoint.

## [2026-05-12] Update direct dependencies
**Changed:** `package.json`, `package-lock.json`
**Why:** Bring the app's direct dependencies up to the latest npm releases.
**Summary:** Updated outdated runtime and dev dependencies, including React, Lucide, Tailwind, Zustand, TypeScript, and Node types. Refreshed the npm lockfile after installation, keeping ESLint on the latest compatible v9 release because ESLint 10 crashes with the current Next ESLint config.

## [2026-05-12] Make npm run dev the local-safe default
**Changed:** `package.json`, `README.md`
**Why:** Keep the normal developer command while avoiding the local freeze issue.
**Summary:** Updated `npm run dev` to use the local stability flags directly and removed the need to run a separate `dev:safe` command. Updated README instructions so the documented startup path is the standard `npm run dev`.

## [2026-05-12] Clarify safe run instructions
**Changed:** `README.md`
**Why:** Make the laptop-safe local run command the first documented path.
**Summary:** Updated Quick start to recommend `npm run dev:safe` from `app/` and moved `npm install` into a conditional step for missing or changed dependencies.

## [2026-05-12] Add low-impact local run guardrails
**Changed:** `.vscode/settings.json` (new), `package.json`, `tsconfig.json`, `README.md`
**Why:** Reduce VS Code and dev-server freeze risk on the user's laptop.
**Summary:** Added VS Code watcher/search exclusions for generated and dependency folders. Added a safer Webpack-based dev script bound to localhost, TypeScript watch exclusions, and README guidance for avoiding repeated installs and runaway local Node processes.

## [2026-05-05] Browser OOM fix via non-persisted stream drafts
**Changed:** `src/lib/stream-drafts.ts` (new), `src/lib/chat-client.ts`, `src/components/ModelColumn.tsx`
**Why:** Streaming token deltas were being written to persisted chat history on every token, causing browser memory exhaustion.
**Summary:** Added a lightweight in-memory draft store for live stream output. Token deltas now write only to the draft store; a single commit to persisted history happens on finish/abort/error. Pending responses render as plain text instead of re-parsing Markdown every token.

## [2026-05-05] Agent instruction files setup
**Changed:** `.github/copilot-instructions.md` (new), `AGENTS.md` (new), `instructions/agent-behavior.md` (new), `instructions/commit-rules.md` (new)
**Why:** Establish consistent agent behavior rules across Copilot and Codex.
**Summary:** Created `instructions/` folder with behavior and commit rules. Set up auto-load entry points for GitHub Copilot (`.github/copilot-instructions.md`) and OpenAI Codex (`AGENTS.md`). Removed old root-level `.agent-commit-rules.md`.
