export type ProviderKey =
  | "openai"
  | "deepseek"
  | "meta"
  | "nvidia"
  | "qwen"
  | "gemini"
  | "zhipu"
  | "minimax"
  | "opencode"
  | "ollama"
  | "custom";

export type ApiProviderKey =
  | "groq"
  | "gemini"
  | "opencode"
  | "ollama-cloud"
  | "ollama-local"
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
  zhipu:    { key: "zhipu",    name: "Zhipu",    color: "#2563eb" },
  minimax:  { key: "minimax",  name: "MiniMax",  color: "#111827" },
  opencode: { key: "opencode", name: "OpenCode", color: "#ea580c" },
  ollama:   { key: "ollama",   name: "Ollama",   color: "#374151" },
  custom:   { key: "custom",   name: "Custom",   color: "#7c3aed" },
};

export const API_PROVIDERS: Record<ApiProviderKey, ApiProviderInfo> = {
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
    color: "#1a73e8",
  },
  opencode: {
    key: "opencode",
    name: "OpenCode Zen",
    shortName: "OpenCode",
    color: "#ea580c",
  },
  "ollama-cloud": {
    key: "ollama-cloud",
    name: "Ollama",
    shortName: "Ollama",
    color: "#111827",
  },
  "ollama-local": {
    key: "ollama-local",
    name: "Local",
    shortName: "Local",
    color: "#374151",
  },
  custom: {
    key: "custom",
    name: "Custom",
    shortName: "Custom",
    color: "#7c3aed",
  },
};

export const PROVIDER_ORDER: ProviderKey[] = [
  "openai",
  "deepseek",
  "meta",
  "nvidia",
  "qwen",
  "gemini",
  "zhipu",
  "minimax",
  "opencode",
  "ollama",
  "custom",
];

export const API_PROVIDER_ORDER: ApiProviderKey[] = [
  "groq",
  "gemini",
  "opencode",
  "ollama-cloud",
  "ollama-local",
  "custom",
];
