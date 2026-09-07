import { useState, useRef, useEffect, useMemo } from "react";
import { useProviderStore, ThinkingLevel } from "../../store/providerStore";
import { useSessionStore } from "../../store/sessionStore";
import { useUiStore } from "../../store/uiStore";
import { useToastStore } from "../../store/toastStore";
import {
  supportsThinking,
  getModelContextLimit,
  formatContextLimit,
} from "../../lib/modelLimits";
import {
  ChevronUp,
  Check,
  KeyRound,
  ShieldAlert,
  Brain,
  RefreshCw,
  Search,
  Zap,
  Sparkles,
  Layers,
  X,
} from "lucide-react";

export function formatModelDisplayName(
  model: string,
  thinking: ThinkingLevel = "high",
  providerId?: string
): string {
  if (!model) return "Gemini 3.8 Flash";
  const clean = model.toLowerCase();
  let base = model;

  // Modern Gemini 3.x and 2.x
  if (clean.includes("3.8-flash") || clean === "gemini-3.8") base = "Gemini 3.8 Flash";
  else if (clean.includes("3.7-flash") || clean === "gemini-3.7") base = "Gemini 3.7 Flash";
  else if (clean.includes("3.6-flash") || clean === "gemini-3.6") base = "Gemini 3.6 Flash";
  else if (clean.includes("3.5-flash") || clean === "gemini-3.5") base = "Gemini 3.5 Flash";
  else if (clean.includes("3.1-pro") || clean === "gemini-3.1") base = "Gemini 3.1 Pro";
  else if (clean.includes("3-pro") || clean === "gemini-3") base = "Gemini 3 Pro";
  else if (clean.includes("2.5-flash") || clean === "gemini-2.5") base = "Gemini 2.5 Flash";
  else if (clean.includes("2.0-flash-thinking")) base = "Gemini 2.0 Flash Thinking";
  else if (clean.includes("2.0-pro")) base = "Gemini 2.0 Pro";
  else if (clean.includes("2.0-flash-lite")) base = "Gemini 2.0 Flash Lite";
  else if (clean.includes("2.0-flash")) base = "Gemini 2.0 Flash";
  else if (clean.includes("1.5-flash-8b")) base = "Gemini 1.5 Flash 8B";
  else if (clean.includes("1.5-flash")) base = "Gemini 1.5 Flash";
  else if (clean.includes("1.5-pro")) base = "Gemini 1.5 Pro";
  else if (clean.startsWith("gemma-2")) base = model;
  else if (clean.includes("claude-3-7-sonnet")) base = "Claude 3.7 Sonnet";
  else if (clean.includes("claude-3-5-sonnet")) base = "Claude 3.5 Sonnet";
  else if (clean.includes("claude-3-5-haiku")) base = "Claude 3.5 Haiku";
  else if (clean.includes("claude-3-opus")) base = "Claude 3 Opus";
  else if (clean.includes("gpt-4o-mini")) base = "GPT-4o Mini";
  else if (clean.includes("gpt-4o")) base = "GPT-4o";
  else if (clean.includes("o1-mini")) base = "OpenAI o1 Mini";
  else if (clean.includes("o1")) base = "OpenAI o1";
  else if (clean.includes("o3-mini")) base = "OpenAI o3 Mini";
  else if (clean.includes("grok-3")) base = "Grok 3";
  else if (clean.includes("grok-2-vision")) base = "Grok 2 Vision";
  else if (clean.includes("grok-2")) base = "Grok 2";
  else if (clean.includes("grok-beta")) base = "Grok Beta";
  else if (clean.includes("grok")) base = "xAI Grok";
  else if (clean.includes("deepseek-reasoner")) base = "DeepSeek Reasoner (R1)";
  else if (clean.includes("deepseek-chat")) base = "DeepSeek Chat (V3)";
  else if (clean.includes("llama-3.3-70b")) base = "Llama 3.3 70B";
  else if (clean.includes("llama-3.1-8b")) base = "Llama 3.1 8B";
  else if (clean.includes("mixtral")) base = "Mixtral 8x7B";

  const isThinkingSupported = supportsThinking(model, providerId);
  if (!isThinkingSupported || thinking === "off") return base;
  const suffix = thinking === "high" ? "High" : thinking === "med" ? "Med" : "Low";
  return `${base} ${suffix}`;
}

interface CategorizedModelItem {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  maxTokens: number;
  tokenBadge: string;
  isThinking: boolean;
}

export function ModelDropupPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    providers,
    activeProviderId,
    activeModel,
    thinkingLevel,
    lastSyncedAt,
    isSyncing,
    setActiveProviderAndModel,
    setThinkingLevel,
    fetchProviderModels,
  } = useProviderStore();
  const { setSessionModel } = useSessionStore();
  const { setActiveView, setActiveSettingsTab } = useUiStore();
  const { addToast } = useToastStore();

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Auto-focus search input on menu open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery("");
    }
  }, [isOpen]);

  // Stale auto-probe when opened: refresh if not synced yet or > 30 minutes ago
  useEffect(() => {
    if (!isOpen) return;
    const activeProv = providers[activeProviderId];
    if (!activeProv) return;
    const hasAuth =
      activeProv.isConfigured ||
      (activeProv.apiKey && activeProv.apiKey.trim().length > 0) ||
      activeProv.id === "gemini";
    if (!hasAuth) return;

    const lastSync = lastSyncedAt[activeProviderId] || 0;
    const thirtyMinutesMs = 30 * 60 * 1000;
    if (Date.now() - lastSync > thirtyMinutesMs) {
      fetchProviderModels(activeProviderId).catch(() => {});
    }
  }, [isOpen, activeProviderId, providers, lastSyncedAt, fetchProviderModels]);

  const isThinkingSupported = useMemo(
    () => supportsThinking(activeModel, activeProviderId),
    [activeModel, activeProviderId]
  );

  // Filter providers that are actively configured
  const configuredProviders = useMemo(() => {
    return Object.values(providers).filter(
      (p) =>
        p.isConfigured ||
        (p.apiKey && p.apiKey.trim().length > 0) ||
        p.type === "local" ||
        p.id === "gemini"
    );
  }, [providers]);

  // Group models into Cursor-style tiers
  const { fastTierModels, reasoningTierModels, otherModels } = useMemo(() => {
    const fast: CategorizedModelItem[] = [];
    const reasoning: CategorizedModelItem[] = [];
    const other: CategorizedModelItem[] = [];

    const query = searchQuery.trim().toLowerCase();

    for (const provider of configuredProviders) {
      for (const modelId of provider.models) {
        const displayName = formatModelDisplayName(modelId, "off", provider.id);
        const limitInfo = getModelContextLimit(modelId, provider.id);
        const tokenBadge = formatContextLimit(limitInfo.maxTokens);
        const isThinking = supportsThinking(modelId, provider.id);

        // Search query filtering
        if (query) {
          const matchSlug = modelId.toLowerCase().includes(query);
          const matchName = displayName.toLowerCase().includes(query);
          const matchProv = provider.name.toLowerCase().includes(query);
          if (!matchSlug && !matchName && !matchProv) continue;
        }

        const item: CategorizedModelItem = {
          providerId: provider.id,
          providerName: provider.name,
          modelId,
          displayName,
          maxTokens: limitInfo.maxTokens,
          tokenBadge,
          isThinking,
        };

        const clean = modelId.toLowerCase();
        // Fast Tier: Flash series, Haiku, Mini
        if (
          clean.includes("flash") ||
          clean.includes("haiku") ||
          (clean.includes("mini") && !clean.includes("o3") && !clean.includes("o1")) ||
          clean.includes("2.5") ||
          clean.includes("3.8") ||
          clean.includes("3.7") ||
          clean.includes("3.6") ||
          clean.includes("3.5")
        ) {
          fast.push(item);
        } else if (
          clean.includes("pro") ||
          clean.includes("thinking") ||
          clean.includes("reasoner") ||
          clean.includes("o1") ||
          clean.includes("o3") ||
          clean.includes("sonnet") ||
          clean.includes("opus") ||
          clean.includes("3.1") ||
          clean.includes("r1")
        ) {
          reasoning.push(item);
        } else {
          other.push(item);
        }
      }
    }

    return {
      fastTierModels: fast,
      reasoningTierModels: reasoning,
      otherModels: other,
    };
  }, [configuredProviders, searchQuery]);

  const handleSelectModel = (providerId: string, model: string) => {
    setActiveProviderAndModel(providerId, model);
    setSessionModel(providerId, model);
    addToast(
      `Switched active model to ${formatModelDisplayName(model, thinkingLevel, providerId)}`,
      "info"
    );
    setIsOpen(false);
  };

  const handleSyncActive = async () => {
    try {
      const models = await fetchProviderModels(activeProviderId);
      addToast(
        `Hot-synced ${models.length} live models for ${providers[activeProviderId]?.name || activeProviderId}`,
        "success"
      );
    } catch {
      addToast(`Failed to sync models for ${activeProviderId}`, "error");
    }
  };

  const handleOpenProviderSettings = () => {
    setActiveView("settings");
    setActiveSettingsTab("providers");
    setIsOpen(false);
  };

  return (
    <div className="relative inline-flex items-center" ref={menuRef}>
      {/* Clean Minimalist Trigger matching Reference Design */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1 py-1 px-1.5 rounded-md text-xs text-[#8b949e] hover:text-white hover:bg-[#21262d] transition cursor-pointer select-none group border border-transparent hover:border-[#30363d]"
        title={`Active Model: ${activeModel}${isThinkingSupported ? ` (${thinkingLevel.toUpperCase()} Thinking)` : ""}. Click to switch model or provider.`}
      >
        <span className="font-medium text-xs text-[#c9d1d9] group-hover:text-white transition">
          {formatModelDisplayName(
            activeModel || "gemini-3.8-flash",
            thinkingLevel,
            activeProviderId
          )}
        </span>
        <ChevronUp
          className={`w-3.5 h-3.5 text-[#8b949e] group-hover:text-white transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dynamic Dropup Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-80 max-h-[460px] flex flex-col bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
          {/* Header & Thinking Budget Row */}
          <div className="px-2.5 py-1.5 bg-[#0d1117]/90 border-b border-[#30363d] flex items-center justify-between flex-shrink-0 text-[10px]">
            <span className="text-[#8b949e] font-medium flex items-center space-x-1">
              <Brain
                className={`w-3 h-3 ${
                  isThinkingSupported ? "text-purple-400" : "text-[#484f58]"
                }`}
              />
              <span className={isThinkingSupported ? "text-[#c9d1d9]" : "text-[#6e7681]"}>
                Thinking {isThinkingSupported ? "" : "(N/A)"}
              </span>
            </span>

            {/* Segmented Pill Group */}
            {isThinkingSupported ? (
              <div className="flex bg-[#161b22] p-0.5 rounded-md border border-[#30363d] text-[9px]">
                {(["off", "low", "med", "high"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => {
                      setThinkingLevel(lvl);
                      addToast(`Thinking budget: ${lvl.toUpperCase()}`, "info");
                    }}
                    className={`px-2 py-0.5 rounded font-medium capitalize transition ${
                      thinkingLevel === lvl
                        ? "bg-purple-600 text-white font-semibold shadow-xs"
                        : "text-[#8b949e] hover:text-white"
                    }`}
                    title={`${lvl.toUpperCase()} thinking budget`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-[10px] text-[#484f58] font-mono italic">
                Standard Model
              </span>
            )}

            <div className="flex items-center space-x-1.5 pl-1">
              <button
                type="button"
                onClick={handleSyncActive}
                disabled={isSyncing[activeProviderId]}
                className="text-[#58a6ff] hover:text-white flex items-center space-x-0.5 text-[10px] transition disabled:opacity-50 cursor-pointer"
                title="Hot-sync live models from provider"
              >
                <RefreshCw
                  className={`w-2.5 h-2.5 ${
                    isSyncing[activeProviderId] ? "animate-spin text-blue-400" : ""
                  }`}
                />
                <span>{isSyncing[activeProviderId] ? "Syncing..." : "Sync"}</span>
              </button>

              <button
                onClick={handleOpenProviderSettings}
                className="text-[#8b949e] hover:text-[#c9d1d9] hover:underline flex items-center space-x-0.5 text-[10px] cursor-pointer"
                title="Manage API Keys"
              >
                <KeyRound className="w-2.5 h-2.5" />
                <span>Keys</span>
              </button>
            </div>
          </div>

          {/* Search Bar Input */}
          <div className="px-2.5 py-2 bg-[#0d1117]/60 border-b border-[#30363d]/70 relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-5 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search models (e.g. 3.8, flash, pro)..."
              className="w-full bg-[#161b22] border border-[#30363d] focus:border-[#58a6ff] rounded-lg pl-8 pr-7 py-1 text-xs text-[#c9d1d9] placeholder-[#6e7681] outline-hidden transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-4 text-[#8b949e] hover:text-white p-0.5"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Scrollable Model Group List */}
          <div className="p-1.5 space-y-3 overflow-y-auto flex-1 max-h-[350px]">
            {configuredProviders.length === 0 ? (
              <div className="p-4 text-center space-y-2">
                <ShieldAlert className="w-5 h-5 text-amber-400 mx-auto" />
                <p className="text-[11px] text-[#8b949e]">
                  No provider API keys configured yet.
                </p>
                <button
                  onClick={handleOpenProviderSettings}
                  className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium"
                >
                  Configure Providers
                </button>
              </div>
            ) : fastTierModels.length === 0 &&
              reasoningTierModels.length === 0 &&
              otherModels.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#8b949e]">
                No models matching &quot;{searchQuery}&quot;
              </div>
            ) : (
              <>
                {/* ⚡ Fast Tier (Flash Series) */}
                {fastTierModels.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-[#58a6ff] flex items-center justify-between">
                      <span className="flex items-center space-x-1">
                        <Zap className="w-3 h-3 text-[#58a6ff]" />
                        <span>⚡ Fast Tier (Flash Series)</span>
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#58a6ff]/10 border border-[#58a6ff]/30 text-[#58a6ff]">
                        1M Context • Speed
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      {fastTierModels.map((item) => {
                        const isSelected =
                          activeProviderId === item.providerId &&
                          activeModel === item.modelId;

                        return (
                          <button
                            key={`${item.providerId}-${item.modelId}`}
                            type="button"
                            onClick={() =>
                              handleSelectModel(item.providerId, item.modelId)
                            }
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition text-[11px] group cursor-pointer ${
                              isSelected
                                ? "bg-blue-600/20 text-[#58a6ff] font-semibold border border-blue-500/40"
                                : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
                            }`}
                          >
                            <div className="flex flex-col min-w-0 mr-2">
                              <span className="truncate font-medium">
                                {item.displayName}
                              </span>
                              <span className="text-[10px] text-[#6e7681] font-mono truncate">
                                {item.modelId}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1.5 flex-shrink-0">
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#8b949e]">
                                {item.tokenBadge}
                              </span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-blue-400" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 🧠 Reasoning Tier (Pro & Thinking) */}
                {reasoningTierModels.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-purple-400 flex items-center justify-between">
                      <span className="flex items-center space-x-1">
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        <span>🧠 Reasoning Tier (Pro & Thinking)</span>
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300">
                        2M Context • Reasoning
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      {reasoningTierModels.map((item) => {
                        const isSelected =
                          activeProviderId === item.providerId &&
                          activeModel === item.modelId;

                        return (
                          <button
                            key={`${item.providerId}-${item.modelId}`}
                            type="button"
                            onClick={() =>
                              handleSelectModel(item.providerId, item.modelId)
                            }
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition text-[11px] group cursor-pointer ${
                              isSelected
                                ? "bg-purple-600/20 text-purple-300 font-semibold border border-purple-500/40"
                                : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
                            }`}
                          >
                            <div className="flex flex-col min-w-0 mr-2">
                              <span className="truncate font-medium">
                                {item.displayName}
                              </span>
                              <span className="text-[10px] text-[#6e7681] font-mono truncate">
                                {item.modelId}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1.5 flex-shrink-0">
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d1117] border border-purple-500/20 text-purple-300">
                                {item.tokenBadge}
                              </span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-purple-400" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 🌐 Other Providers & Models */}
                {otherModels.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-[#8b949e] flex items-center justify-between">
                      <span className="flex items-center space-x-1">
                        <Layers className="w-3 h-3 text-[#8b949e]" />
                        <span>Other Models</span>
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      {otherModels.map((item) => {
                        const isSelected =
                          activeProviderId === item.providerId &&
                          activeModel === item.modelId;

                        return (
                          <button
                            key={`${item.providerId}-${item.modelId}`}
                            type="button"
                            onClick={() =>
                              handleSelectModel(item.providerId, item.modelId)
                            }
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition text-[11px] group cursor-pointer ${
                              isSelected
                                ? "bg-blue-600/20 text-[#58a6ff] font-semibold border border-blue-500/40"
                                : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
                            }`}
                          >
                            <div className="flex flex-col min-w-0 mr-2">
                              <span className="truncate font-medium">
                                {item.displayName}
                              </span>
                              <span className="text-[10px] text-[#6e7681] font-mono truncate">
                                {item.providerName} • {item.modelId}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1.5 flex-shrink-0">
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#8b949e]">
                                {item.tokenBadge}
                              </span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-blue-400" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
