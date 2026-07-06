# Alles AI - Compare LLMs side-by-side

**Alles AI** sends a single prompt to multiple free or BYOK AI routes and streams their responses **side-by-side** in real time.

![status](https://img.shields.io/badge/status-active-brightgreen)
![next](https://img.shields.io/badge/Next.js-16-black)
![ts](https://img.shields.io/badge/TypeScript-5-blue)

## Models

| Model | Default source | Other selectable sources | Context | Notes |
|---|---|---|---|---|
| GPT-OSS 120B | Groq | Local Ollama if installed | 128K | Reasoning |
| Llama 4 Scout 17B | Groq | Local Ollama if installed | 128K | Vision |
| Qwen3 32B | Groq | Local Ollama if installed | 128K | General |
| Gemini 2.5 Flash Lite | Google Gemini API | - | 1M | Vision |
| big-pickle, DeepSeek V4 Flash Free, MiMo 2.5 Free, North Mini Code Free, Nemotron 3 Ultra Free | OpenCode Zen | - | 128K | Curated free OpenCode Zen models |
| Qwen3.5 397B, Gemma 4 31B, MiniMax M3 | Ollama (hosted API) | Local Ollama if installed | varies | Optional hosted reasoning/coding models |

Core Groq and Gemini routes, plus the curated OpenCode Zen `-free` models, are available on free API tiers with your own key. Groq models require a [Groq API key](https://console.groq.com). Gemini requires a [Google AI Studio key](https://aistudio.google.com/api-keys). OpenCode Zen models require an OpenCode API key; only models with the `-free` suffix are free, others in its browsable catalog are paid.
Optional hosted Ollama models require an Ollama API key, and some hosted models require an Ollama subscription. Optional local models come from your own Ollama install and are selected from the models already pulled on your machine. Users can also browse and add other (paid) models from Groq, Gemini, OpenCode Zen, and custom OpenAI-compatible providers via Settings.

## Features

- **Multi-model side-by-side chat** - fan a prompt out to all selected models in parallel
- **One row per model family** - choose GPT-OSS once, then switch the API source between Groq, Ollama, or local
- **Token-by-token streaming** per column independently
- **BYOK** - API keys stored only in your browser's `localStorage`, never on a server
- **Per-column multi-turn** - each model keeps its own conversation thread
- **Focus mode** - click the focus icon on any column to direct further prompts to one model only
- **Pause / resume columns** - toggle individual models on/off without losing their history
- **Drag to reorder** columns
- **Provider toggles** - show only the APIs you want to use
- **Optional local Ollama models** - refresh installed local models and compare them beside hosted APIs
- **Optional Ollama models** - compare hosted ollama.com models without adding duplicate columns for the same model family
- **Shared web search** - Tavily MCP runs once per prompt and gives every selected model the same current source context
- **Quality consensus answer** - synthesizes model responses with the best eligible synthesis route
- **Model council** - runs multiple models through opening, critique, and convergence rounds before a moderated final answer
- **Quick / deep synthesis** - choose a faster answer or deeper claim-checking with confidence and quality notes
- **Thinking block** - collapsible `<think>` reasoning display for models that support it
- **Markdown + syntax highlighting** for code-heavy responses
- **Persistent history** in `localStorage` - full conversation sidebar with search and delete confirmation
- **Compact columns** for dense desktop comparisons
- **Stop streaming** per-column or globally

## Tech stack

- **Next.js 16** (App Router, Edge runtime) + **React 19** + **TypeScript 5**
- **Tailwind CSS 4** + **lucide-react** icons
- **Zustand 5** (with `persist`) for client state and chat history
- **react-markdown** + **remark-gfm** + **rehype-highlight** for rendering
- **Groq** chat completions API (OpenAI-compatible, SSE -> NDJSON proxy)
- **Google Gemini** native streaming API (SSE -> NDJSON proxy)
- **Tavily MCP** for shared real-time web context
- **Ollama** local chat API (NDJSON to NDJSON proxy)

## Quick start

```bash
cd app
npm run dev
```

Open <http://localhost:3000>, click **Settings**, add your API keys, then start chatting.

Only run `npm install` when `node_modules` is missing or `package.json` dependencies changed:

```bash
cd app
npm install
```

### Local run notes

- Run project commands from the `app/` folder only.
- Do not repeat `npm install` unless `package.json` dependencies changed or `node_modules` is missing.
- Avoid starting the dev server while many old `node.exe` processes are already running.
- `npm run dev` is configured for this laptop to bind to `127.0.0.1` and use Webpack, which avoids the local freeze issue while keeping the normal command.
- Treat installs, builds, formatters, and long-running watchers as approval-only when working through Codex.

For local models, install and run [Ollama](https://ollama.com), enable **Local models** in Settings, refresh installed models, then select the local models from **Models**.
For hosted Ollama models, enable **Ollama models** in Settings, add your Ollama API key, then choose Ollama from a model's source dropdown.

### Environment variables (optional server-side keys)

Create `.env.local` in the `app/` folder:

```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OLLAMA_API_KEY=ollama_...
TAVILY_API_KEY=tvly-...
# or:
TAVILY_MCP_URL=https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-...
```

If set, these act as fallback keys so visitors do not need their own. Client-provided keys from Settings always take priority.

## Architecture

```
Browser (Next.js page)
  |-- Zustand store (conversations, threads, settings) -> localStorage
  `-- For each selected model:
        POST /api/search ------------------------------> Tavily MCP
                       <-------------------------------- shared source context
        POST /api/chat  --------------------------------> Groq / Gemini / local Ollama / Ollama API
                       <-------------------------------- NDJSON (delta | usage | done | error)

  Consensus / council:
        POST /api/consensus ---------------------------> selected synthesis model / council models
                            <-------------------------- NDJSON (delta | status | council_note | done)
```

- `/api/chat` - routes to Groq, Gemini, local Ollama, or the Ollama API based on model ID prefix
- `/api/search` - gets shared web results from Tavily MCP when web search is enabled
- `/api/consensus` - takes all model responses, runs quick or deep synthesis, and can run a multi-round model council with a dedicated final moderator
- `/api/ollama/models` - lists installed Ollama models from the configured local base URL

## Project structure

```
src/
  app/
    page.tsx              # Main UI shell
    layout.tsx            # Root layout + fonts
    globals.css           # Theme tokens + markdown styles
    api/
      chat/route.ts       # Streaming proxy -> Groq / Gemini / Ollama
      consensus/route.ts  # Consensus synthesis endpoint
      search/route.ts     # Tavily MCP search proxy
      ollama/models/      # Installed local model discovery
  components/
    Composer.tsx          # Bottom chat input bar
    HeroComposer.tsx      # First-prompt landing screen
    ConsensusButton.tsx   # Floating consensus trigger + panel
    ModelColumn.tsx       # Per-model response column
    ModelPicker.tsx       # Model selection dialog
    ProviderIcon.tsx      # Brand icon tiles
    SettingsDialog.tsx    # API key + system prompt settings
    Sidebar.tsx           # Conversation history sidebar
    Markdown.tsx          # Memoized markdown renderer
  lib/
    models.ts             # Model catalog + provider groups
    providers.ts          # Provider metadata
    store.ts              # Zustand store (settings + chat state)
    chat-client.ts        # Streaming fetch logic + abort control
    utils.ts              # cn() + uid()
```

## License

MIT
