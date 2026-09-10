import React, { useState } from 'react';
import {
  X,
  Search,
  Bot,
  Plug,
  ChevronDown,
} from 'lucide-react';

interface MarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AgentItem {
  id: string;
  creator?: string;
  name: string;
  author?: string;
  desc?: string;
  accent: string;
}


export const MarketplaceModal: React.FC<MarketplaceModalProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<'plugins' | 'agents'>('agents');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [featuredAgents] = useState<AgentItem[]>([]);
  const [agentList] = useState<AgentItem[]>([]);

  if (!isOpen) return null;

  const categories = [
    'All',
    'From Frostfire Team',
    'Engineering',
    'Sales',
    'Marketing',
    'Design',
    'Personal',
  ];

  const filteredAgents = agentList.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.author && a.author.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-2xl bg-theme-surface border border-theme-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] z-10 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="h-14 px-5 border-b border-theme-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold text-theme-text-primary">Marketplace</h2>

          {/* Toggle Plugins | Agents */}
          <div className="flex items-center p-0.5 rounded-full bg-theme-bg border border-theme-border text-xs">
            <button
              onClick={() => setTab('plugins')}
              className={`px-3 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer ${
                tab === 'plugins'
                  ? 'bg-theme-surface text-theme-text-primary font-semibold shadow-xs'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Plug className="w-3.5 h-3.5" />
              Plugins
            </button>
            <button
              onClick={() => setTab('agents')}
              className={`px-3 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer ${
                tab === 'agents'
                  ? 'bg-theme-surface text-theme-text-primary font-semibold shadow-xs'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Agents
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Featured Row */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
              Featured
            </span>
            {featuredAgents.length === 0 ? (
              <div className="py-6 px-4 border border-dashed border-theme-border rounded-xl text-center text-theme-text-muted">
                No featured agents available in registry.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {featuredAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="p-3 rounded-xl border border-theme-border bg-theme-bg/60 hover:bg-theme-bg transition-colors flex flex-col items-center text-center cursor-pointer group"
                  >
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center border mb-2 shadow-xs group-hover:scale-105 transition-transform ${agent.accent}`}
                    >
                      <Bot className="w-6 h-6" />
                    </div>
                    {agent.creator && (
                      <span className="text-[10px] text-theme-text-muted block truncate w-full">
                        {agent.creator}
                      </span>
                    )}
                    <span className="font-bold text-xs text-theme-text-primary block truncate w-full">
                      {agent.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input
              type="text"
              placeholder="Search by creator or Agent name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-theme-bg border border-theme-border text-theme-text-primary pl-9 pr-4 py-2 rounded-xl outline-none focus:border-theme-accent-primary text-xs placeholder:text-theme-text-muted"
            />
          </div>

          {/* Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1 rounded-full text-xs shrink-0 transition-all cursor-pointer ${
                  activeCategory === cat
                    ? 'bg-theme-text-primary text-theme-bg font-semibold'
                    : 'bg-theme-bg border border-theme-border text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {cat}
              </button>
            ))}
            <button className="px-2.5 py-1 rounded-full text-xs text-theme-text-muted border border-theme-border bg-theme-bg flex items-center gap-1 shrink-0 cursor-pointer">
              More <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {/* Agent List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-theme-text-primary">
                From Frostfire Team
              </span>
              <button className="text-xs text-theme-accent-primary hover:underline cursor-pointer">
                View all
              </button>
            </div>

            {filteredAgents.length === 0 ? (
              <div className="py-8 px-4 border border-dashed border-theme-border rounded-xl text-center text-theme-text-muted">
                No agents available in registry.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="p-3 rounded-xl border border-theme-border bg-theme-bg/60 hover:bg-theme-bg transition-all flex items-start gap-3 cursor-pointer"
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 mt-0.5 ${agent.accent}`}
                    >
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-bold text-xs text-theme-text-primary truncate">
                          {agent.name}
                        </span>
                        {agent.author && (
                          <span className="text-[10px] text-theme-text-muted truncate">
                            by {agent.author}
                          </span>
                        )}
                      </div>
                      {agent.desc && (
                        <p className="text-[11px] text-theme-text-muted line-clamp-2 mt-0.5 leading-relaxed">
                          {agent.desc}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
