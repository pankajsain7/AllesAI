export type ProviderKey =
  | "openai"
  | "deepseek"
  | "meta"
  | "nvidia"
  | "qwen"
  | "gemini"
  | "zhipu"
  | "minimax"
  | "mistral"
  | "moonshot"
  | "opencode"
  | "ollama"
  | "bedrock"
  | "custom";

export type ApiProviderKey =
  | "bedrock"
  | "groq"
  | "opencode"
  | "ollama-cloud"
  | "ollama-local"
  | "gemini"
  | "custom";

export type ProviderInfo = {
  key: ProviderKey;
  name: string;
  color: string;
};

export type ApiProviderInfo = {
  key: ApiProviderKey;
  name: string;
  shortName: string;
  color: string;
};

export const PROVIDERS: Record<ProviderKey, ProviderInfo> = {
  openai:   { key: "openai",   name: "OpenAI",   color: "#10a37f" },
  deepseek: { key: "deepseek", name: "DeepSeek", color: "#4d6bfe" },
  meta:     { key: "meta",     name: "Meta",     color: "#0082fb" },
  nvidia:   { key: "nvidia",   name: "NVIDIA",   color: "#76b900" },
  qwen:     { key: "qwen",     name: "Qwen",     color: "#6750a4" },
  gemini:   { key: "gemini",   name: "Google",   color: "#1a73e8" },
  zhipu:    { key: "zhipu",    name: "Z.ai",     color: "#2563eb" },
  minimax:  { key: "minimax",  name: "MiniMax",  color: "#111827" },
  mistral:  { key: "mistral",  name: "Mistral",  color: "#fa520f" },
  moonshot: { key: "moonshot", name: "Moonshot", color: "#0f172a" },
  opencode: { key: "opencode", name: "OpenCode", color: "#ea580c" },
  ollama:   { key: "ollama",   name: "Ollama",   color: "#374151" },
  bedrock:  { key: "bedrock",  name: "Bedrock",  color: "#ff9900" },
  custom:   { key: "custom",   name: "Custom",   color: "#7c3aed" },
};

export const API_PROVIDERS: Record<ApiProviderKey, ApiProviderInfo> = {
  bedrock: {
    key: "bedrock",
    name: "Amazon Bedrock",
    shortName: "Bedrock",
    color: "#ff9900",
  },
  groq: {
    key: "groq",
    name: "Groq",
    shortName: "Groq",
    color: "#f55036",
  },
  gemini: {
    key: "gemini",
    name: "Gemini API",
    shortName: "Gemini",
    color: "#1f2937",
  },
  opencode: {
    key: "opencode",
    name: "OpenCode Zen",
    shortName: "OpenCode",
    color: "#7c3aed",
  },
  "ollama-cloud": {
    key: "ollama-cloud",
    name: "Ollama",
    shortName: "Ollama",
    color: "#06b6d4",
  },
  "ollama-local": {
    key: "ollama-local",
    name: "Local",
    shortName: "Local",
    color: "#64748b",
  },
  custom: {
    key: "custom",
    name: "Custom",
    shortName: "Custom",
    color: "#8b5cf6",
  },
};

export const PROVIDER_ORDER: ProviderKey[] = [
  "openai",
  "deepseek",
  "zhipu",
  "moonshot",
  "mistral",
  "qwen",
  "nvidia",
  "meta",
  "minimax",
  "opencode",
  "ollama",
  "bedrock",
  "gemini",
  "custom",
];

// Bedrock first: measured fastest to first token with the most long-context
// headroom. Gemini sits near the bottom by request.
export const API_PROVIDER_ORDER: ApiProviderKey[] = [
  "bedrock",
  "groq",
  "ollama-cloud",
  "opencode",
  "ollama-local",
  "gemini",
  "custom",
];
