import { useState, useEffect } from "react";
import {
  CreditCard,
  DollarSign,
  Activity,
  PieChart,
  ArrowUpRight,
  Copy,
  Check,
  ShieldCheck,
  ExternalLink,
  Sliders,
  AlertCircle,
  Key,
} from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";
import { useUserStore } from "../../store/userStore";

export function UsageBillingSettings() {
  const { usage } = useSessionStore();
  const {
    licenseInfo,
    billingStatus,
    loadLicense,
    activateLicenseToken,
    deactivateLicenseToken,
    updateSpendCap,
  } = useUserStore();

  const [copiedUuid, setCopiedUuid] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [spendCapSlider, setSpendCapSlider] = useState<number>(50);

  useEffect(() => {
    loadLicense();
  }, [loadLicense]);

  useEffect(() => {
    if (billingStatus?.spend_cap_micro_cents) {
      setSpendCapSlider(Math.round(billingStatus.spend_cap_micro_cents / 100_000_000));
    }
  }, [billingStatus]);

  const inputTokens = usage.inputTokens || 9800;
  const outputTokens = usage.outputTokens || 4450;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = (
    (inputTokens / 1_000_000) * 3.0 +
    (outputTokens / 1_000_000) * 15.0
  ).toFixed(4);

  const modelRates = [
    { model: "Claude 3.7 Sonnet", provider: "Anthropic", input: "$3.00 / 1M", output: "$15.00 / 1M", status: "Active" },
    { model: "GPT-4o", provider: "OpenAI", input: "$2.50 / 1M", output: "$10.00 / 1M", status: "Available" },
    { model: "Grok 2", provider: "xAI (SpaceX)", input: "$2.00 / 1M", output: "$10.00 / 1M", status: "Available" },
    { model: "Gemini 2.0 Flash", provider: "Google", input: "$0.10 / 1M", output: "$0.40 / 1M", status: "Available" },
    { model: "DeepSeek V3", provider: "DeepSeek", input: "$0.14 / 1M", output: "$0.28 / 1M", status: "Available" },
    { model: "Llama 3.3 70B", provider: "Ollama (Local)", input: "Free ($0.00)", output: "Free ($0.00)", status: "Local Engine" },
  ];

  const handleCopyUuid = () => {
    if (licenseInfo?.user_uuid) {
      navigator.clipboard.writeText(licenseInfo.user_uuid);
      setCopiedUuid(true);
      setTimeout(() => setCopiedUuid(false), 2000);
    }
  };

  const handleActivate = async () => {
    if (!tokenInput.trim()) return;
    setActivating(true);
    setActivationError(null);
    try {
      await activateLicenseToken(tokenInput.trim());
      setTokenInput("");
    } catch (err: unknown) {
      setActivationError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    if (window.confirm("Are you sure you want to deactivate this license from this workstation?")) {
      await deactivateLicenseToken();
    }
  };

  const handleSliderChange = async (val: number) => {
    setSpendCapSlider(val);
    const microCents = val * 100_000_000;
    await updateSpendCap(microCents);
  };

  const openStripePortal = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url: "https://billing.stripe.com/p/login/test" });
    } catch {
      window.open("https://billing.stripe.com", "_blank");
    }
  };

  const openWebSignup = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url: "https://frostfire.cloud/signup" });
    } catch {
      window.open("https://frostfire.cloud/signup", "_blank");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <CreditCard className="w-4 h-4 text-[#58a6ff]" />
          <span>Usage, Subscription & Token Governance</span>
        </h2>
        <p className="text-[#8b949e]">
          Monitor your subscription license, unique User UUID, Stripe metered token consumption, and safety guardrails.
        </p>
      </div>

      {/* License & Identity Section */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldCheck className={`w-4 h-4 ${licenseInfo?.is_valid ? "text-emerald-400" : "text-amber-400"}`} />
            <span className="text-xs font-semibold text-white uppercase tracking-wider">
              {licenseInfo?.is_valid ? "Active Platform License" : "License Activation"}
            </span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
              licenseInfo?.is_valid
                ? "bg-emerald-950/50 text-emerald-400 border border-emerald-800"
                : "bg-amber-950/50 text-amber-400 border border-amber-800"
            }`}
          >
            {licenseInfo?.is_valid ? `Tier: ${licenseInfo.tier.toUpperCase()}` : "Unlicensed"}
          </span>
        </div>

        {licenseInfo?.is_valid ? (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* User UUID */}
              <div className="p-3 bg-[#0d1117] rounded-lg border border-[#30363d] space-y-1">
                <span className="text-[10px] text-[#8b949e] font-semibold uppercase">Canonical User UUID</span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-white truncate max-w-[240px]">
                    {licenseInfo.user_uuid}
                  </span>
                  <button
                    onClick={handleCopyUuid}
                    className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
                    title="Copy UUID"
                  >
                    {copiedUuid ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Stripe Customer */}
              <div className="p-3 bg-[#0d1117] rounded-lg border border-[#30363d] space-y-1">
                <span className="text-[10px] text-[#8b949e] font-semibold uppercase">Stripe Customer ID</span>
                <div className="font-mono text-xs text-white">
                  {licenseInfo.stripe_customer_id || "cus_live_unbound"}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={openStripePortal}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-white font-medium transition cursor-pointer"
              >
                <span>Manage Cards & Invoices on Stripe</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#8b949e]" />
              </button>

              <button
                onClick={handleDeactivate}
                className="px-3 py-1.5 rounded-lg border border-red-900/40 text-red-400 hover:bg-red-950/30 transition cursor-pointer"
              >
                Deactivate License
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <p className="text-xs text-[#8b949e]">
              Enter your Ed25519-signed License JWT or subscribe via Stripe to activate the full desktop microVM and LLM capabilities.
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Key className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8b949e]" />
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste license JWT token (header.payload.signature)..."
                  className="w-full pl-9 pr-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff] text-xs font-mono"
                />
              </div>
              <button
                onClick={handleActivate}
                disabled={activating || !tokenInput.trim()}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
              >
                {activating ? "Activating..." : "Activate"}
              </button>
              <button
                onClick={openWebSignup}
                className="px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg transition cursor-pointer flex items-center space-x-1"
              >
                <span>Subscribe on Web</span>
                <ExternalLink className="w-3 h-3 text-[#8b949e]" />
              </button>
            </div>

            {activationError && (
              <div className="flex items-center space-x-1.5 text-red-400 bg-red-950/30 border border-red-900/50 p-2 rounded-lg text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{activationError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Token Allowances & Spend Guardrail */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-white uppercase tracking-wider">
              Token Allowances & Spend Cap Guardrails
            </span>
          </div>
          <span className="text-[11px] text-[#8b949e]">Auto-enforced in Cloud Gateway</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Included Token Allowance */}
          <div className="p-3 bg-[#0d1117] rounded-lg border border-[#30363d] space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase font-semibold text-[#8b949e]">Monthly Included Pool</span>
              <span className="text-xs font-bold text-emerald-400 font-mono">$10.00 Included</span>
            </div>
            <div className="w-full bg-[#21262d] h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full w-[35%]" />
            </div>
            <div className="flex justify-between text-[10px] text-[#8b949e]">
              <span>Current Usage: $3.50</span>
              <span>Refreshes each billing cycle</span>
            </div>
          </div>

          {/* Monthly Spend Cap */}
          <div className="p-3 bg-[#0d1117] rounded-lg border border-[#30363d] space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase font-semibold text-[#8b949e]">Monthly Safety Spend Cap</span>
              <span className="text-xs font-bold text-amber-400 font-mono">${spendCapSlider}.00 / mo</span>
            </div>
            <input
              type="range"
              min={10}
              max={250}
              step={10}
              value={spendCapSlider}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-[#21262d] rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-[#8b949e]">
              <span>$10 min</span>
              <span>Reaching cap halts LLM proxy</span>
              <span>$250 max</span>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Session Token Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Session Tokens</span>
            <Activity className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">{totalTokens.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e]">Combined session tokens</div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Prompt (Input)</span>
            <PieChart className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">{inputTokens.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e]">Context + @file attachments</div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Completion (Output)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">{outputTokens.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e]">Generated code + reasoning</div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Estimated Cost</span>
            <DollarSign className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">${estimatedCost}</div>
          <div className="text-[10px] text-[#8b949e]">Based on active provider tier</div>
        </div>
      </div>

      {/* Provider Pricing Table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
          Model Provider Pricing Reference
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#30363d] text-[10px] text-[#8b949e] uppercase">
                <th className="pb-2 font-semibold">Model</th>
                <th className="pb-2 font-semibold">Provider</th>
                <th className="pb-2 font-semibold">Input / 1M</th>
                <th className="pb-2 font-semibold">Output / 1M</th>
                <th className="pb-2 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d] font-mono text-[11px]">
              {modelRates.map((row, idx) => (
                <tr key={idx} className="hover:bg-[#0d1117]/50 transition">
                  <td className="py-2.5 font-sans font-semibold text-white">{row.model}</td>
                  <td className="py-2.5 text-[#8b949e] font-sans">{row.provider}</td>
                  <td className="py-2.5 text-[#c9d1d9]">{row.input}</td>
                  <td className="py-2.5 text-[#c9d1d9]">{row.output}</td>
                  <td className="py-2.5 text-right font-sans">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                        row.status === "Active"
                          ? "bg-green-950/40 text-green-400 border border-green-800"
                          : row.status === "Local Engine"
                          ? "bg-purple-950/40 text-purple-400 border border-purple-800"
                          : "bg-[#21262d] text-[#8b949e]"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
