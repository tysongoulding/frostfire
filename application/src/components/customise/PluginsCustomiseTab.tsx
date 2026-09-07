import { useState, useMemo } from "react";
import {
  usePluginStore,
  PluginItem,
  PluginCategory,
} from "../../store/pluginStore";
import { useToastStore } from "../../store/toastStore";
import {
  Mail,
  HardDrive,
  Calendar,
  FileText,
  Table2,
  Presentation,
  Sparkles,
  Briefcase,
  ToyBrick,
  Code2,
  Users,
  Check,
  Plus,
  Search,
  X,
  Loader2,
  Key,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

function getPluginIcon(iconKey: PluginItem["iconKey"], color: string) {
  const iconClass = `w-4 h-4 ${color}`;
  switch (iconKey) {
    case "gmail":
      return <Mail className={iconClass} />;
    case "drive":
      return <HardDrive className={iconClass} />;
    case "calendar":
      return <Calendar className={iconClass} />;
    case "docs":
      return <FileText className={iconClass} />;
    case "sheets":
      return <Table2 className={iconClass} />;
    case "slides":
      return <Presentation className={iconClass} />;
    case "granola":
      return <Sparkles className={iconClass} />;
    case "atlassian":
      return <Briefcase className={iconClass} />;
    case "sdk":
      return <ToyBrick className={iconClass} />;
    case "dev":
      return <Code2 className={iconClass} />;
    case "team":
      return <Users className={iconClass} />;
    default:
      return <ToyBrick className={iconClass} />;
  }
}

export function PluginsCustomiseTab() {
  const {
    plugins,
    searchQuery,
    selectedCategory,
    isConnecting,
    tokenModalPluginId,
    setSearchQuery,
    setSelectedCategory,
    setTokenModalPluginId,
    togglePlugin,
    connectOAuth,
    saveTokenAuth,
    disconnectPlugin,
    resetToDefaults,
  } = usePluginStore();

  const { addToast } = useToastStore();
  const [tokenInput, setTokenInput] = useState("");
  const [isHoveredId, setIsHoveredId] = useState<string | null>(null);

  const categories: PluginCategory[] = [
    "All",
    "Google Workspace",
    "Knowledge & Notes",
    "Issue Trackers",
    "Developer Extensions",
  ];

  const filteredPlugins = useMemo(() => {
    return plugins.filter((plugin) => {
      const matchCategory =
        selectedCategory === "All" || plugin.category === selectedCategory;
      const query = searchQuery.trim().toLowerCase();
      const matchSearch =
        !query ||
        plugin.name.toLowerCase().includes(query) ||
        plugin.description.toLowerCase().includes(query) ||
        plugin.capabilities.some((c) => c.toLowerCase().includes(query));
      return matchCategory && matchSearch;
    });
  }, [plugins, selectedCategory, searchQuery]);

  const addedCount = useMemo(
    () => plugins.filter((p) => p.isAdded).length,
    [plugins]
  );

  const handleActionClick = async (plugin: PluginItem) => {
    if (plugin.isAdded) {
      disconnectPlugin(plugin.id);
      addToast(`Disconnected ${plugin.name}`, "info");
      return;
    }

    if (plugin.authType === "oauth") {
      addToast(`Initiating OAuth for ${plugin.name}...`, "info");
      const success = await connectOAuth(plugin.id);
      if (success) {
        addToast(`Successfully connected ${plugin.name}`, "success");
      } else {
        addToast(`Failed to authenticate ${plugin.name}`, "error");
      }
    } else if (plugin.authType === "token") {
      setTokenInput(plugin.token || "");
      setTokenModalPluginId(plugin.id);
    } else {
      await togglePlugin(plugin.id);
      addToast(`Activated ${plugin.name}`, "success");
    }
  };

  const handleSaveToken = async () => {
    if (!tokenModalPluginId) return;
    if (!tokenInput.trim()) {
      addToast("Please enter a valid credential token", "error");
      return;
    }
    await saveTokenAuth(tokenModalPluginId, tokenInput.trim());
    addToast("Saved credentials and activated plugin", "success");
    setTokenInput("");
  };

  const tokenModalPlugin = plugins.find((p) => p.id === tokenModalPluginId);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-xs text-[#c9d1d9] overflow-hidden">
      {/* Top Header & Toolbar */}
      <div className="border-b border-[#30363d] bg-[#161b22]/70 px-5 py-3 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-[#58a6ff]">
            <ToyBrick className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold text-white">Plugins & Workspace OAuth</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                {addedCount} / {plugins.length} Added
              </span>
            </div>
            <p className="text-[11px] text-[#8b949e] truncate">
              Dense directory of workspace OAuth integrations, notes bridges, and compiled daemon plugins.
            </p>
          </div>
        </div>

        {/* Right Search & Quick Actions */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter plugins or capabilities..."
              className="bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] rounded-lg pl-8 pr-7 py-1 text-xs text-[#c9d1d9] placeholder-[#6e7681] outline-hidden w-52 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 text-[#8b949e] hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={resetToDefaults}
            className="p-1.5 rounded-lg border border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
            title="Reset to default plugin list"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Category Tabs Filter */}
      <div className="border-b border-[#30363d] bg-[#161b22]/40 px-5 py-2 flex items-center space-x-1 overflow-x-auto flex-shrink-0 select-none scrollbar-none">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat;
          const count =
            cat === "All"
              ? plugins.length
              : plugins.filter((p) => p.category === cat).length;

          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                isActive
                  ? "bg-[#21262d] text-white border border-[#30363d]"
                  : "text-[#8b949e] hover:text-white hover:bg-[#161b22] border border-transparent"
              }`}
            >
              <span>{cat}</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  isActive
                    ? "bg-blue-500/20 text-[#58a6ff]"
                    : "bg-[#0d1117] text-[#6e7681]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dense Plugin Rows List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {filteredPlugins.length === 0 ? (
          <div className="p-8 text-center text-[#8b949e] space-y-2">
            <ToyBrick className="w-6 h-6 mx-auto text-[#484f58]" />
            <p>No plugins matching &quot;{searchQuery}&quot;</p>
          </div>
        ) : (
          filteredPlugins.map((plugin) => {
            const isConnectingThis = isConnecting[plugin.id];
            const isHovered = isHoveredId === plugin.id;

            return (
              <div
                key={plugin.id}
                className={`flex items-center justify-between px-3.5 py-2 rounded-xl border transition ${
                  plugin.isAdded
                    ? "bg-[#161b22]/90 border-[#30363d] hover:border-emerald-500/40"
                    : "bg-[#161b22]/50 border-[#30363d]/60 hover:border-[#30363d] hover:bg-[#161b22]"
                }`}
              >
                {/* Left: Icon, Name & Category */}
                <div className="flex items-center space-x-3 min-w-[240px] max-w-[280px] flex-shrink-0">
                  <div className="p-2 rounded-lg bg-[#0d1117] border border-[#30363d] flex-shrink-0">
                    {getPluginIcon(plugin.iconKey, plugin.color)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-semibold text-white truncate text-xs">
                        {plugin.name}
                      </span>
                      {plugin.badge && (
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#0d1117] border border-[#30363d] text-[#8b949e]">
                          {plugin.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#6e7681] truncate block">
                      {plugin.category}
                    </span>
                  </div>
                </div>

                {/* Middle: Description & Capability Chips */}
                <div className="flex-1 min-w-0 px-4 hidden md:flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[#8b949e] truncate max-w-sm">
                    {plugin.description}
                  </p>
                  <div className="flex items-center space-x-1 flex-shrink-0 overflow-hidden">
                    {plugin.capabilities.slice(0, 3).map((cap, i) => (
                      <span
                        key={i}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d]/60 text-[#8b949e] whitespace-nowrap"
                      >
                        {cap}
                      </span>
                    ))}
                    {plugin.capabilities.length > 3 && (
                      <span className="text-[9px] font-mono text-[#6e7681]">
                        +{plugin.capabilities.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Dense Action Button (+ Add / ✓ Added) */}
                <div className="flex items-center space-x-2 flex-shrink-0 pl-2">
                  <button
                    type="button"
                    onClick={() => handleActionClick(plugin)}
                    disabled={isConnectingThis}
                    onMouseEnter={() => setIsHoveredId(plugin.id)}
                    onMouseLeave={() => setIsHoveredId(null)}
                    className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer select-none ${
                      isConnectingThis
                        ? "bg-[#21262d] text-[#8b949e] border border-[#30363d] cursor-wait"
                        : plugin.isAdded
                        ? isHovered
                          ? "bg-red-500/15 text-red-400 border border-red-500/40"
                          : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-[#21262d] hover:bg-[#58a6ff]/20 text-[#c9d1d9] hover:text-[#58a6ff] border border-[#30363d] hover:border-[#58a6ff]/40"
                    }`}
                    title={
                      plugin.isAdded
                        ? "Click to disconnect"
                        : `Connect ${plugin.name}`
                    }
                  >
                    {isConnectingThis ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#58a6ff]" />
                        <span>Connecting...</span>
                      </>
                    ) : plugin.isAdded ? (
                      isHovered ? (
                        <>
                          <X className="w-3.5 h-3.5 text-red-400" />
                          <span>Disconnect</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-semibold">Added</span>
                        </>
                      )
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5 text-[#8b949e] group-hover:text-white" />
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Granola / Token Input Modal */}
      {tokenModalPluginId && tokenModalPlugin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 select-none">
            <div className="px-4 py-3 bg-[#0d1117] border-b border-[#30363d] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Key className="w-4 h-4 text-purple-400" />
                <span className="font-semibold text-white text-xs">
                  Connect {tokenModalPlugin.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTokenModalPluginId(null)}
                className="text-[#8b949e] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#c9d1d9] space-y-1">
                <div className="flex items-center space-x-1.5 text-purple-300 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Encrypted Keystore Storage</span>
                </div>
                <p className="text-[11px] text-[#8b949e]">
                  Enter your {tokenModalPlugin.name} API token or session key. Credentials are encrypted in your OS hardware keystore and never logged.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-[#c9d1d9]">
                  API Token / Secret Key
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={`Enter ${tokenModalPlugin.name} API Key / Token...`}
                  className="w-full bg-[#0d1117] border border-[#30363d] focus:border-purple-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#6e7681] outline-hidden transition font-mono"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#30363d]/50">
                <button
                  type="button"
                  onClick={() => setTokenModalPluginId(null)}
                  className="px-3 py-1.5 rounded-lg border border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d] transition text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveToken}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition text-xs flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save & Connect</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
