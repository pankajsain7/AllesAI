# Alles AI — Compare LLMs Side-by-Side

![status](https://img.shields.io/badge/status-active-brightgreen)
![next](https://img.shields.io/badge/Next.js-16-black)
![ts](https://img.shields.io/badge/TypeScript-6-blue)
![license](https://img.shields.io/badge/license-MIT-green)

**Alles AI** fans a single prompt out to multiple AI models in parallel and streams their responses **side-by-side** in real time. Compare outputs, run consensus synthesis, or pit models against each other in a structured council debate — all from one interface, entirely BYOK.

---

## Live Models

| Model | Provider | API | Context | Capability |
|---|---|---|---|---|
| GPT-OSS 120B | OpenAI (open-weight) | Groq | 128K | Reasoning, thinking |
| Qwen 3.8 27B | Qwen / Alibaba | Groq | 128K | All-purpose chat, code, reasoning |
| Qwen 3.6 27B | Qwen / Alibaba | Groq | 128K | Fast reasoning, analysis |
| GPT-OSS 20B | OpenAI (open-weight) | Groq | 128K | Ultra-fast responses |
| Gemini 3.5 Flash | Google | Gemini API | 1M | Latest Google model, vision |
| Gemma 4 31B | Google | Ollama Cloud | 256K | General, vision, thinking |
| Nemotron 3 Super | NVIDIA | Ollama Cloud | 128K | Reasoning & analysis |

> All core models are **free** on their respective API tiers with your own key.
> Ollama Cloud models require an [ollama.com](https://ollama.com) account (some require a paid tier).

### Browse & Import More Models

Go to **Settings → Browse models** to import additional models from:
- **Groq** — dozens of extra hosted models
- **Gemini** — full Google model catalog
- **OpenCode Zen** — Claude, GPT-5, Gemini 3.x and more (paid)
- **Custom** — any OpenAI-compatible endpoint (local or remote)

---

## Consensus & Council: how models are chosen

Consensus and council never guess. Every run is planned by
[`src/lib/consensus-plan.ts`](src/lib/consensus-plan.ts) in five steps:

1. **Detect credentials.** Read which provider keys are present and which
   providers are enabled in Settings. Local Ollama needs no key.
2. **Collect eligible models.** Take every route those providers expose, drop
   models on the removed list, and keep the ones cleared for consensus.
3. **Rank them.** Models verified against the live APIs sit in a roster in
   [`src/lib/model-rules.ts`](src/lib/model-rules.ts) as `primary` (fast,
   reliable, strong) or `backup` (works, but slower or weaker). Ranking is
   tier → measured latency → context window. Imported models the app has not
   verified stay pickable but are never auto-selected ahead of a verified one.
4. **Assign roles.**
   - *Synthesizer* — highest tier with the largest context window, since it
     reads the entire multi-model transcript.
   - *Debaters* — two models from **different providers**, so the debate has
     genuinely different viewpoints.
   - *Judges* — kept off the debate floor whenever the pool allows it.
5. **Build the backup bench.** Everything left over, interleaved across
   providers so one revoked key, rate limit, or outage cannot wipe out the
   whole bench at once.

### When a model fails

| Failure | Handling |
|---|---|
| Rate limit / gateway blip (429, 502, 503, 504) | Retried once on the same model after a short delay — a transient error should not burn a backup |
| Auth, not-found, bad request | Permanent; move straight to the next model on the bench |
| Context overflow (413 or token-limit error) | Context budget halved, then retried on the next model |
| Empty response or stalled stream | Treated as a failure; the next model takes over |
| Debater fails mid-round | Replaced from the bench, and the swap is reported to the UI via a `status` event |
| Judge panel fails | Non-fatal — synthesis continues without a scorecard |

A model that has already streamed text is never retried, so partial answers are
never duplicated.

### Verifying it still works

```bash
npm run check:models          # live probe of every model route
npm run check:consensus       # planner role assignment across key combinations
npm run check:consensus:live  # + real consensus, council, and fault-injection runs
```

`check:consensus:live` needs `npm run dev` running, and deliberately injects a
dead model and a bad API key to prove the backup bench recovers.

---

## Features

### Chat
- **Multi-model parallel chat** — fan one prompt to all selected models simultaneously
- **Token-by-token streaming** — each column streams independently
- **Per-column conversation threads** — each model keeps its own multi-turn history
- **Focus mode** — lock further prompts to one column only
- **Pause / resume columns** — toggle models on/off without losing history
- **Stop streaming** — abort one column or all at once
- **Drag to reorder** columns

### Models & Providers
- **Model picker** — grouped by model family; switch API source per model
- **Provider toggles** — show only the providers you have keys for
- **Local Ollama** — discover and chat with models installed on your machine
- **Hosted Ollama** — use ollama.com API without running Ollama locally
- **Custom providers** — add any OpenAI-compatible API endpoint

### Intelligence
- **Shared web search** — Tavily search runs once per prompt and gives every model the same real-time context
- **Consensus answer** — synthesizes all model responses into a single best answer using the strongest eligible model
- **Quick / deep synthesis** — choose faster summary or deep claim-checking with confidence and quality notes
- **Model council** — structured multi-round debate: opening arguments → critique → convergence → moderated final verdict
- **Thinking blocks** — collapsible `<think>` reasoning for models that expose chain-of-thought

### UI / UX
- **Markdown + syntax highlighting** — code-heavy responses render cleanly
- **Compact columns** — dense desktop layout for many models at once
- **Persistent history** — full conversation sidebar with search and delete
- **BYOK** — API keys stored only in browser `localStorage`, never sent to a server
- **System prompt** — custom instructions applied across all models

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Edge runtime) |
| UI | React 19, Tailwind CSS 4, lucide-react |
| State | Zustand 5 (with `persist` → localStorage) |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Language | TypeScript 6 |
| AI APIs | Groq (SSE), Google Gemini (SSE), Ollama (NDJSON) |
| Search | Tavily MCP |

---

## Quick Start

```bash
cd app
npm install       # only needed once, or when package.json changes
npm run dev
```

Open **http://localhost:3000**, click **Settings**, add your API keys, and start chatting.

---

## API Keys

Create `.env.local` in the `app/` folder to set server-side fallback keys (visitors without keys can still use the app):

```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OLLAMA_API_KEY=<ollama.com api key>
tavilyApiKey=tvly-...
OpenCode_API_Key=sk-...
```

Client-provided keys entered in **Settings** always take priority over `.env.local` keys.

### Where to get keys

| Provider | Free Tier | Link |
|---|---|---|
| Groq | ✅ Yes | https://console.groq.com |
| Google Gemini | ✅ Yes | https://aistudio.google.com/api-keys |
| Ollama Cloud | ✅ Yes (some models need paid) | https://ollama.com |
| Tavily | ✅ Yes (1000 searches/month) | https://tavily.com |
| OpenCode Zen | ❌ Paid | https://opencode.ai |

---

## Architecture

```
Browser (Next.js App Router)
  |-- Zustand store (conversations, threads, settings) → localStorage
  `-- For each selected model:
        POST /api/search ──────────────────────────────► Tavily MCP
                         ◄────────────────────────────── shared source context
        POST /api/chat ────────────────────────────────► Groq / Gemini / Ollama / Custom
                       ◄────────────────────────────────  NDJSON (delta | usage | done | error)

  Consensus / Council:
        POST /api/consensus ───────────────────────────► synthesis model / council models
                            ◄──────────────────────────── NDJSON (delta | status | council_note | done)
```

### API Routes

| Route | Purpose |
|---|---|
| `/api/chat` | Streams responses from Groq, Gemini, Ollama Cloud, Local Ollama, or custom |
| `/api/chat/multi` | Fans a prompt to multiple models in one request |
| `/api/consensus` | Synthesizes responses; runs quick or deep council debate |
| `/api/search` | Tavily MCP proxy for shared web context |
| `/api/groq/models` | Lists browsable Groq models |
| `/api/gemini/models` | Lists browsable Gemini models |
| `/api/ollama/models` | Lists installed local Ollama models |
| `/api/opencode/models` | Lists OpenCode Zen models |
| `/api/custom/models` | Lists models from custom providers |

---

## Project Structure

```
app/
├── src/
│   ├── app/
│   │   ├── page.tsx                # Main UI shell
│   │   ├── layout.tsx              # Root layout + metadata
│   │   ├── globals.css             # Theme tokens + markdown styles
│   │   └── api/
│   │       ├── chat/route.ts       # Streaming proxy → Groq / Gemini / Ollama
│   │       ├── chat/multi/route.ts # Multi-model fan-out
│   │       ├── consensus/route.ts  # Synthesis + council endpoint
│   │       ├── search/route.ts     # Tavily MCP proxy
│   │       ├── groq/models/        # Groq model browser
│   │       ├── gemini/models/      # Gemini model browser
│   │       ├── ollama/models/      # Local Ollama discovery
│   │       ├── opencode/models/    # OpenCode Zen browser
│   │       └── custom/models/      # Custom provider models
│   ├── components/
│   │   ├── Composer.tsx            # Bottom chat input bar
│   │   ├── HeroComposer.tsx        # First-prompt landing screen
│   │   ├── ModelColumn.tsx         # Per-model response column
│   │   ├── ModelPicker.tsx         # Model selection dialog
│   │   ├── SingleModelPicker.tsx   # Single model selector
│   │   ├── ModeSelector.tsx        # Chat / Consensus / Council toggle
│   │   ├── ConsensusButton.tsx     # Floating consensus trigger + panel
│   │   ├── SharedResultsLane.tsx   # Consensus / council results lane
│   │   ├── SuperColumn.tsx         # Full-width synthesis column
│   │   ├── ProviderIcon.tsx        # Brand icon tiles
│   │   ├── SettingsDialog.tsx      # API keys + system prompt + model browser
│   │   ├── Sidebar.tsx             # Conversation history sidebar
│   │   ├── Markdown.tsx            # Memoized markdown renderer
│   │   ├── Button.tsx              # Shared button component
│   │   └── Logo.tsx                # App logo
│   └── lib/
│       ├── models.ts               # Model catalog + Ollama presets + browser helpers
│       ├── model-rules.ts          # Consensus/council allowlist + access rules
│       ├── providers.ts            # Provider metadata + colors
│       ├── store.ts                # Zustand store (settings + chat state)
│       ├── chat-client.ts          # Streaming fetch + abort control
│       ├── stream-drafts.ts        # Draft management for streaming
│       ├── scroll-intent.ts        # Smart auto-scroll logic
│       └── utils.ts                # cn() + uid() helpers
├── public/
│   └── AllesAI.png                 # App icon
├── .env.local                      # API keys (not committed)
├── next.config.ts
├── postcss.config.mjs
└── tsconfig.json
```

---

## Local Development Notes

- Run all commands from the `app/` directory
- `npm run dev` binds to `127.0.0.1` with Webpack (avoids local freeze issues)
- Only run `npm install` when `node_modules` is missing or `package.json` changes
- For local Ollama models: install [Ollama](https://ollama.com), enable **Local models** in Settings, then refresh

---

## License

MIT
