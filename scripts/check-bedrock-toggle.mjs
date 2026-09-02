// Reproduce "unable to turn on Bedrock" against realistic persisted settings.
// Usage: node --import tsx scripts/check-bedrock-toggle.mjs
const memory = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  },
});
globalThis.window ??= { localStorage: globalThis.localStorage, addEventListener() {} };

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures += 1;
};

console.log("=== Scenario A: brand-new user (nothing persisted) ===\n");
{
  const { useSettings } = await import("../src/lib/store.ts?a=" + Date.now());
  check("bedrockEnabled defaults true", useSettings.getState().bedrockEnabled === true);
  useSettings.getState().setBedrockEnabled(false);
  check("can turn off", useSettings.getState().bedrockEnabled === false);
  useSettings.getState().setBedrockEnabled(true);
  check("can turn back on", useSettings.getState().bedrockEnabled === true);
}

console.log("\n=== Scenario B: existing user, persisted BEFORE Bedrock existed (version 10) ===\n");
{
  localStorage.setItem(
    "alles-ai-settings",
    JSON.stringify({
      state: {
        apiKey: "gsk_existing",
        groqEnabled: true,
        opencodeApiKey: "",
        opencodeEnabled: false,
        opencodeModels: [],
        groqExtraModels: [],
        systemPrompt: "You are a helpful, concise assistant.",
        webSearch: false,
        tavilyApiKey: "",
        compactColumns: false,
        consensusModel: "openai/gpt-oss-120b",
        saveConsensusToChat: false,
        localEnabled: false,
        ollamaBaseUrl: "http://localhost:11434",
        ollamaApiKey: "",
        cloudOllamaEnabled: false,
        ollamaCloudBaseUrl: "https://ollama.com",
        ollamaCloudModels: [],
        customProviders: [],
        // no bedrock* fields at all — this user predates the feature
      },
      version: 10,
    })
  );
  const { useSettings } = await import("../src/lib/store.ts?b=" + Date.now());
  await new Promise((r) => setTimeout(r, 20));
  console.log("   after migrate from v10:", JSON.stringify({
    bedrockEnabled: useSettings.getState().bedrockEnabled,
    bedrockApiKey: useSettings.getState().bedrockApiKey,
  }));
  check("migrated user gets bedrockEnabled=true", useSettings.getState().bedrockEnabled === true);
  useSettings.getState().setBedrockApiKey("ABSKtest=");
  check("can set the key", useSettings.getState().bedrockApiKey === "ABSKtest=");

  // Simulate a reload: read back what got persisted.
  const persisted = JSON.parse(localStorage.getItem("alles-ai-settings"));
  console.log("   persisted after set:", JSON.stringify({
    bedrockEnabled: persisted.state.bedrockEnabled,
    bedrockApiKey: persisted.state.bedrockApiKey,
    version: persisted.version,
  }));
  check("bedrockEnabled survives to storage", persisted.state.bedrockEnabled === true);
  check("bedrockApiKey survives to storage", persisted.state.bedrockApiKey === "ABSKtest=");
}

console.log("\n=== Scenario C: existing user, persisted AT version 11 with bedrockEnabled explicitly false ===\n");
{
  localStorage.setItem(
    "alles-ai-settings",
    JSON.stringify({
      state: {
        apiKey: "gsk_existing",
        groqEnabled: true,
        opencodeApiKey: "",
        opencodeEnabled: false,
        opencodeModels: [],
        groqExtraModels: [],
        systemPrompt: "You are a helpful, concise assistant.",
        webSearch: false,
        tavilyApiKey: "",
        compactColumns: false,
        consensusModel: "openai/gpt-oss-120b",
        saveConsensusToChat: false,
        localEnabled: false,
        ollamaBaseUrl: "http://localhost:11434",
        ollamaApiKey: "",
        cloudOllamaEnabled: false,
        ollamaCloudBaseUrl: "https://ollama.com",
        ollamaCloudModels: [],
        bedrockApiKey: "",
        bedrockEnabled: false,
        bedrockModels: ["zai.glm-4.7-flash"],
        customProviders: [],
      },
      version: 12,
    })
  );
  const { useSettings } = await import("../src/lib/store.ts?c=" + Date.now());
  await new Promise((r) => setTimeout(r, 20));
  check("same-version load keeps persisted false (no migrate re-run)", useSettings.getState().bedrockEnabled === false);
  useSettings.getState().setBedrockEnabled(true);
  check("clicking the toggle turns it on", useSettings.getState().bedrockEnabled === true);
  const persisted = JSON.parse(localStorage.getItem("alles-ai-settings"));
  check("the ON state is actually persisted", persisted.state.bedrockEnabled === true, JSON.stringify(persisted.state.bedrockEnabled));
}

console.log("\n=== Scenario D: existing user with models retired from the catalog (glm-4.7-flash, ministral-14b) ===\n");
{
  localStorage.setItem(
    "alles-ai-settings",
    JSON.stringify({
      state: {
        apiKey: "",
        groqEnabled: true,
        opencodeApiKey: "",
        opencodeEnabled: false,
        opencodeModels: [],
        groqExtraModels: [],
        systemPrompt: "You are a helpful, concise assistant.",
        webSearch: false,
        tavilyApiKey: "",
        compactColumns: false,
        consensusModel: "bedrock/zai.glm-4.7-flash",
        saveConsensusToChat: false,
        localEnabled: false,
        ollamaBaseUrl: "http://localhost:11434",
        ollamaApiKey: "",
        cloudOllamaEnabled: false,
        ollamaCloudBaseUrl: "https://ollama.com",
        ollamaCloudModels: [],
        bedrockApiKey: "ABSKtest=",
        bedrockEnabled: true,
        // Persisted before the catalog was decluttered to one flagship per vendor.
        bedrockModels: [
          "zai.glm-4.7-flash",
          "mistral.ministral-3-14b-instruct",
          "moonshotai.kimi-k2.5",
          "deepseek.v3.2",
        ],
        customProviders: [],
      },
      version: 11,
    })
  );
  const { useSettings } = await import("../src/lib/store.ts?d=" + Date.now());
  await new Promise((r) => setTimeout(r, 20));
  const models = useSettings.getState().bedrockModels;
  check("retired glm-4.7-flash is remapped to glm-5, not just dropped", models.includes("zai.glm-5"), JSON.stringify(models));
  check("retired ministral-3-14b-instruct is remapped to mistral-large-3", models.includes("mistral.mistral-large-3-675b-instruct"), JSON.stringify(models));
  check("the retired names themselves no longer appear", !models.includes("zai.glm-4.7-flash") && !models.includes("mistral.ministral-3-14b-instruct"), JSON.stringify(models));
  check("previously imported models are kept", models.includes("moonshotai.kimi-k2.5") && models.includes("deepseek.v3.2"));
  check(
    "every current default model is present after migrate",
    Object.keys((await import("../src/lib/models.ts")).BEDROCK_KNOWN_MODELS).every((name) => models.includes(name)),
    JSON.stringify(models)
  );
}

console.log(failures === 0 ? "\nAll toggle checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
