export interface ModelLimitInfo {
  maxTokens: number;
  displayName: string;
  providerName: string;
}

export function getModelContextLimit(modelName?: string, providerId?: string): ModelLimitInfo {
  const cleanModel = (modelName || "").toLowerCase();

  // Google Gemini Family
  if (
    cleanModel.includes("3.1-pro") ||
    cleanModel.includes("3-pro") ||
    cleanModel.includes("2.0-pro") ||
    cleanModel.includes("gemini-1.5-pro") ||
    cleanModel.includes("gemini-pro")
  ) {
    return { maxTokens: 2097152, displayName: modelName || "gemini-3.1-pro", providerName: "Google Gemini" };
  }
  if (
    cleanModel.includes("gemini-1.5-flash") ||
    cleanModel.includes("gemini-flash") ||
    cleanModel.includes("gemini-2.0") ||
    cleanModel.includes("gemini-2.5") ||
    cleanModel.includes("gemini-3.")
  ) {
    return { maxTokens: 1048576, displayName: modelName || "gemini-3.8-flash", providerName: "Google Gemini" };
  }
  if (cleanModel.includes("flash-lite") || cleanModel.includes("gemma")) {
    return { maxTokens: 1048576, displayName: modelName || "gemini-flash-lite", providerName: "Google Gemini" };
  }

  // Anthropic Claude Family
  if (cleanModel.includes("claude-3-7-sonnet") || cleanModel.includes("claude-3-5-sonnet") || cleanModel.includes("claude-3.5-sonnet")) {
    return { maxTokens: 200000, displayName: modelName || "claude-3-5-sonnet-20241022", providerName: "Anthropic" };
  }
  if (cleanModel.includes("claude-3-5-haiku") || cleanModel.includes("claude-3-haiku")) {
    return { maxTokens: 200000, displayName: modelName || "claude-3-5-haiku-20241022", providerName: "Anthropic" };
  }
  if (cleanModel.includes("claude-3-opus") || cleanModel.includes("opus")) {
    return { maxTokens: 200000, displayName: modelName || "claude-3-opus-20240229", providerName: "Anthropic" };
  }

  // OpenAI Family
  if (cleanModel.includes("gpt-4o-mini")) {
    return { maxTokens: 128000, displayName: modelName || "gpt-4o-mini", providerName: "OpenAI" };
  }
  if (cleanModel.includes("gpt-4o") || cleanModel.includes("gpt-4-turbo") || cleanModel.includes("chatgpt")) {
    return { maxTokens: 128000, displayName: modelName || "gpt-4o", providerName: "OpenAI" };
  }
  if (cleanModel.includes("o1") || cleanModel.includes("o3-mini")) {
    return { maxTokens: 200000, displayName: modelName || "o1-preview", providerName: "OpenAI" };
  }

  // DeepSeek Family
  if (cleanModel.includes("deepseek")) {
    return { maxTokens: 64000, displayName: modelName || "deepseek-chat", providerName: "DeepSeek" };
  }

  // Groq / Meta Llama Family
  if (cleanModel.includes("llama-3.3-70b") || cleanModel.includes("llama")) {
    return { maxTokens: 131072, displayName: modelName || "llama-3.3-70b-versatile", providerName: "Groq (Llama)" };
  }
  if (cleanModel.includes("mixtral")) {
    return { maxTokens: 32768, displayName: modelName || "mixtral-8x7b-32768", providerName: "Groq (Mistral)" };
  }

  // xAI (SpaceX / Grok) Family
  if (cleanModel.includes("grok")) {
    return { maxTokens: 131072, displayName: modelName || "grok-2-1212", providerName: "xAI (SpaceX / Grok)" };
  }

  // Ollama Local LLM
  if (providerId === "ollama") {
    return { maxTokens: 32768, displayName: modelName || "llama3.2 (Local)", providerName: "Ollama (Local LLM)" };
  }

  // Fallback default
  return {
    maxTokens: 128000,
    displayName: modelName || "Unknown Model",
    providerName: providerId ? providerId.toUpperCase() : "Custom Provider",
  };
}

export function formatContextLimit(tokens: number): string {
  if (tokens >= 2000000) return "2M";
  if (tokens >= 1000000) return "1M";
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}

export function supportsThinking(modelName?: string, providerId?: string): boolean {
  if (!modelName) return false;
  const clean = modelName.toLowerCase();

  // Gemini thinking models
  if (
    clean.includes("2.0-flash-thinking") ||
    clean.includes("thinking") ||
    clean.includes("3.8") ||
    clean.includes("3.7") ||
    clean.includes("3.1")
  ) {
    return true;
  }

  // Anthropic extended thinking models
  if (clean.includes("claude-3-7-sonnet") || clean.includes("claude-3.7")) {
    return true;
  }

  // OpenAI reasoning effort models
  if (clean.includes("o1") || clean.includes("o3")) {
    return true;
  }

  // DeepSeek reasoning models
  if (clean.includes("r1") || clean.includes("reasoner")) {
    return true;
  }

  // xAI Grok reasoning models
  if (clean.includes("grok-3") || clean.includes("grok-reasoning")) {
    return true;
  }

  return false;
}
