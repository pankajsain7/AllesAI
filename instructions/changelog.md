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
**Summary:** Added `opencode` as a real `ProviderKey`/`ApiProviderKey`, added the 5 free OpenCode Zen models (Big Pickle, DeepSeek V4 Flash Free, MiMo 2.5 Free, North Mini Code Free, Nemotron 3 Ultra Free) to the model catalog, added `opencodeApiKey`/`opencodeEnabled` to the settings store (persist v6 migration), added OpenCode access checks to `model-rules.ts`, added a streaming `opencode/` route in `/api/chat` (mirrors the consensus route's Zen gateway call), wired the API key through `chat-client.ts`, added a Settings toggle + key input, and included OpenCode in `ModelPicker`/`SingleModelPicker`/`Composer`/`HeroComposer`/`page.tsx` enabled-provider plumbing. Verified with `tsc --noEmit`, `next lint`, and `next build`.


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
