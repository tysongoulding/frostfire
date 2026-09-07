import { ProviderSettings } from "./ProviderSettings";
import { Key } from "lucide-react";

export function ModelProviderSettingsView() {
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
        <div>
          <h2 className="text-sm font-semibold text-white mb-0.5 flex items-center space-x-2">
            <Key className="w-4 h-4 text-[#58a6ff]" />
            <span>API or OAuth Providers</span>
          </h2>
          <p className="text-[#8b949e]">
            Configure your AI model providers with API keys or native OAuth 2.0 PKCE browser authentication.
          </p>
        </div>
      </div>

      <ProviderSettings />
    </div>
  );
}
