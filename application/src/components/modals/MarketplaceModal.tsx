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

const FEATURED_BOTS = [
  {
    id: 'f1',
    creator: "Lauren Tan's",
    name: 'dr eggbot',
    accent: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  },
  {
    id: 'f2',
    creator: "Lenny Rachitsky's",
    name: 'Overheard',
    accent: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  {
    id: 'f3',
    creator: "Claire Vo's",
    name: 'Tradbot',
    accent: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
  {
    id: 'f4',
    creator: "Eric Zakariasson's",
    name: 'Projects Manager',
    accent: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  },
];

const BOT_LIST = [
  {
    id: 'b1',
    name: 'dr eggbot',
    author: 'Lauren Tan',
    desc: 'Designs high-quality Frostfire agents. Asks a few preferences and exports configured blueprints.',
    accent: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  },
  {
    id: 'b2',
    name: 'Projects Manager',
    author: 'Eric Zakariasson',
    desc: 'Runs your team&apos;s projects from Notion: one row per project, synced to GitHub sprints.',
    accent: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  },
  {
    id: 'b3',
    name: 'Outbound Prospecting',
    author: 'Krista Letz',
    desc: 'Finds prospects that match your ideal customer, crawls LinkedIn signals, and writes personalized intros.',
    accent: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
  {
    id: 'b4',
    name: 'SEO & AEO Desk',
    author: 'Adam Tanguay',
    desc: 'Turns your keywords into content ideas and writers briefs optimized for answer engines.',
    accent: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  },
  {
    id: 'b5',
    name: 'Haggle Bot',
    author: 'Daniel Gartsbein',
    desc: 'Inventories your SaaS spend from Ramp and bills, flagging duplicate seats and negotiating contracts.',
    accent: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  {
    id: 'b6',
    name: 'Recruiting Coordinator',
    author: 'Tommy Hansen',
    desc: 'Schedules interview loops, preps your interviewers with scorecards, and drafts feedback summaries.',
    accent: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  },
];

export const MarketplaceModal: React.FC<MarketplaceModalProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<'plugins' | 'bots'>('bots');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

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

          {/* Toggle Plugins | Bots */}
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
              onClick={() => setTab('bots')}
              className={`px-3 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer ${
                tab === 'bots'
                  ? 'bg-theme-surface text-theme-text-primary font-semibold shadow-xs'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Bots
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {FEATURED_BOTS.map((bot) => (
                <div
                  key={bot.id}
                  className="p-3 rounded-xl border border-theme-border bg-theme-bg/60 hover:bg-theme-bg transition-colors flex flex-col items-center text-center cursor-pointer group"
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center border mb-2 shadow-xs group-hover:scale-105 transition-transform ${bot.accent}`}
                  >
                    <Bot className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] text-theme-text-muted block truncate w-full">
                    {bot.creator}
                  </span>
                  <span className="font-bold text-xs text-theme-text-primary block truncate w-full">
                    {bot.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input
              type="text"
              placeholder="Search by creator or Bot name"
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

          {/* Bot List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-theme-text-primary">
                From Frostfire Team
              </span>
              <button className="text-xs text-theme-accent-primary hover:underline cursor-pointer">
                View all
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {BOT_LIST.filter(
                (b) =>
                  b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  b.author.toLowerCase().includes(searchQuery.toLowerCase())
              ).map((bot) => (
                <div
                  key={bot.id}
                  className="p-3 rounded-xl border border-theme-border bg-theme-bg/60 hover:bg-theme-bg transition-all flex items-start gap-3 cursor-pointer"
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 mt-0.5 ${bot.accent}`}
                  >
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-bold text-xs text-theme-text-primary truncate">
                        {bot.name}
                      </span>
                      <span className="text-[10px] text-theme-text-muted truncate">
                        by {bot.author}
                      </span>
                    </div>
                    <p className="text-[11px] text-theme-text-muted line-clamp-2 mt-0.5 leading-relaxed">
                      {bot.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
