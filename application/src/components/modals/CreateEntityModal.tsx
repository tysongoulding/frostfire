import React, { useState, useEffect } from 'react';
import { X, Bot, Users, Sparkles, ChevronDown, Check } from 'lucide-react';

export interface AgentOption {
  id: string;
  name: string;
  role: string;
}

export interface InitialEntityData {
  id?: string;
  name?: string;
  role?: string;
  description?: string;
  notifications?: boolean;
  selectedAgentIds?: string[];
}

interface CreateEntityModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'agent' | 'team';
  mode?: 'create' | 'edit';
  initialData?: InitialEntityData | null;
  availableAgents?: AgentOption[];
  onCreate: (
    name: string,
    role: string,
    description?: string,
    notifications?: boolean,
    selectedAgentIds?: string[]
  ) => void;
  onSave?: (
    id: string,
    name: string,
    role: string,
    description?: string,
    notifications?: boolean,
    selectedAgentIds?: string[]
  ) => void;
}

export const CreateEntityModal: React.FC<CreateEntityModalProps> = ({
  isOpen,
  onClose,
  entityType,
  mode = 'create',
  initialData,
  availableAgents = [],
  onCreate,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [missionObjective, setMissionObjective] = useState('');
  const [notifications, setNotifications] = useState(true);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);

  useEffect(() => {
    if (isOpen && initialData) {
      setName(initialData.name || '');
      setRole(initialData.role || '');
      setDescription(initialData.description || '');
      setMissionObjective(initialData.description || '');
      setNotifications(initialData.notifications ?? true);
      setSelectedAgentIds(initialData.selectedAgentIds || []);
    } else if (isOpen) {
      setName('');
      setRole('');
      setDescription('');
      setMissionObjective('');
      setNotifications(true);
      setSelectedAgentIds([]);
    }
    setIsAgentDropdownOpen(false);
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const toggleAgentSelection = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(agentId)) {
        return prev.filter((id) => id !== agentId);
      }
      if (prev.length >= 6) {
        return prev;
      }
      return [...prev, agentId];
    });
  };

  const isTeam = entityType === 'team';
  const isSubmitDisabled = !name.trim() || (isTeam && selectedAgentIds.length < 2);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) return;

    if (mode === 'edit' && initialData?.id && onSave) {
      onSave(
        initialData.id,
        name.trim(),
        isTeam ? `Autonomous Team (${selectedAgentIds.length} agents)` : (role.trim() || 'Specialized Agent'),
        isTeam ? missionObjective.trim() : description.trim(),
        notifications,
        isTeam ? selectedAgentIds : undefined
      );
    } else if (entityType === 'team') {
      onCreate(
        name.trim(),
        `Autonomous Team (${selectedAgentIds.length} agents)`,
        missionObjective.trim(),
        true,
        selectedAgentIds
      );
    } else {
      onCreate(
        name.trim(),
        role.trim() || 'Specialized Agent',
        description.trim(),
        notifications
      );
    }

    setName('');
    setRole('');
    setDescription('');
    setMissionObjective('');
    setSelectedAgentIds([]);
    setIsAgentDropdownOpen(false);
    setNotifications(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md bg-theme-surface border border-theme-border rounded-2xl shadow-2xl p-6 z-10 animate-in fade-in zoom-in-95 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-theme-border">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shadow-xs ${
              isTeam ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
            }`}>
              {isTeam ? <Users className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-theme-text-primary">
                {mode === 'edit'
                  ? isTeam
                    ? 'Edit Team Profile'
                    : 'Edit Agent Profile'
                  : isTeam
                  ? 'Create New Team'
                  : 'Deploy New Agent'}
              </h3>
              <p className="text-[11px] text-theme-text-muted">
                {mode === 'edit'
                  ? 'Update operational configuration and assignments'
                  : isTeam
                  ? 'Configure an orchestrated multi-agent swarm'
                  : 'Provision a dedicated autonomous worker'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {isTeam ? (
            <>
              {/* 1. Team Name */}
              <div className="space-y-1.5">
                <label className="text-theme-text-primary font-medium flex items-center justify-between">
                  <span>Team Name</span>
                  <span className="text-[10px] text-rose-400 font-normal">Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SRE Swarm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/60 transition-colors"
                />
              </div>

              {/* 2. Mission Objective */}
              <div className="space-y-1.5">
                <label className="text-theme-text-primary font-medium flex items-center justify-between">
                  <span>Mission Objective</span>
                  <span className="text-[10px] text-rose-400 font-normal">Required</span>
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Autonomous incident response, triage network escalations, and coordinate remediation workflows..."
                  value={missionObjective}
                  onChange={(e) => setMissionObjective(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/60 resize-none transition-colors"
                />
              </div>

              {/* 3. Agent Selection (Multi-select dropdown, min 2, max 6) */}
              <div className="space-y-1.5 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <label className="text-theme-text-primary font-medium">
                      Agent Selection
                    </label>
                    <span className="text-[10px] text-theme-text-muted">(Min 2, Max 6)</span>
                  </div>
                  <span
                    className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                      selectedAgentIds.length === 6
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 font-semibold'
                        : selectedAgentIds.length < 2
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}
                  >
                    {selectedAgentIds.length} / 6 selected
                  </span>
                </div>

                {/* Dropdown Trigger */}
                <button
                  type="button"
                  onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                  className="w-full flex items-center justify-between bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-left text-theme-text-primary hover:border-theme-accent-primary transition-colors cursor-pointer"
                >
                  <span className="text-theme-text-muted/80 truncate">
                    {selectedAgentIds.length === 0
                      ? 'Select team members (min 2, max 6)...'
                      : `${selectedAgentIds.length} agent${selectedAgentIds.length > 1 ? 's' : ''} assigned`}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-theme-text-muted transition-transform ${
                      isAgentDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {selectedAgentIds.length < 2 && (
                  <p className="text-[11px] text-rose-400/90 pt-0.5">
                    Select at least 2 agents to deploy a team.
                  </p>
                )}

                {/* Selected Agent Badges */}
                {selectedAgentIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedAgentIds.map((id) => {
                      const agent = availableAgents.find((a) => a.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-theme-bg border border-theme-border text-[11px] text-theme-text-primary"
                        >
                          <span className="truncate max-w-[120px]">{agent?.name || id}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAgentSelection(id);
                            }}
                            className="text-theme-text-muted hover:text-rose-400 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Dropdown Menu */}
                {isAgentDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-30 max-h-48 overflow-y-auto bg-theme-surface border border-theme-border rounded-xl shadow-2xl p-1.5 space-y-0.5 animate-in fade-in zoom-in-95">
                    {availableAgents.map((agent) => {
                      const isSelected = selectedAgentIds.includes(agent.id);
                      const isMaxReached = selectedAgentIds.length >= 6 && !isSelected;

                      return (
                        <button
                          key={agent.id}
                          type="button"
                          disabled={isMaxReached}
                          onClick={() => toggleAgentSelection(agent.id)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-theme-accent-primary/15 text-theme-accent-primary font-medium'
                              : isMaxReached
                              ? 'opacity-40 cursor-not-allowed text-theme-text-muted'
                              : 'text-theme-text-primary hover:bg-theme-bg'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'bg-theme-accent-primary border-theme-accent-primary text-black'
                                  : 'border-theme-border bg-theme-bg'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <div className="min-w-0">
                              <span className="block text-xs truncate font-medium">
                                {agent.name}
                              </span>
                              <span className="block text-[10px] text-theme-text-muted truncate">
                                {agent.role}
                              </span>
                            </div>
                          </div>

                          {isMaxReached && (
                            <span className="text-[9px] text-theme-text-muted shrink-0 pl-1">
                              Max 6
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* 1. Agent Name */}
              <div className="space-y-1.5">
                <label className="text-theme-text-primary font-medium flex items-center justify-between">
                  <span>Agent Name</span>
                  <span className="text-[10px] text-rose-400 font-normal">Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NetSecurity Guard"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/60 transition-colors"
                />
              </div>

              {/* 2. Label (role or title) Optional */}
              <div className="space-y-1.5">
                <label className="text-theme-text-primary font-medium flex items-center justify-between">
                  <span>Label (role or title)</span>
                  <span className="text-[10px] text-theme-text-muted font-normal">Optional</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Executive Intelligence"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/60 transition-colors"
                />
              </div>

              {/* 3. Description */}
              <div className="space-y-1.5">
                <label className="text-theme-text-primary font-medium flex items-center justify-between">
                  <span>Description</span>
                  <span className="text-[10px] text-theme-text-muted font-normal">Optional</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe what this agent does, key responsibilities, or special instructions..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/60 resize-none transition-colors"
                />
              </div>

              {/* 4. Notification Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-theme-bg border border-theme-border">
                <div className="space-y-0.5 pr-2">
                  <span className="block text-xs font-semibold text-theme-text-primary">
                    Notifications
                  </span>
                  <span className="block text-[11px] text-theme-text-muted leading-tight">
                    Get notified when this Bot finishes or needs input
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setNotifications(!notifications)}
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer ${
                    notifications
                      ? 'bg-theme-accent-primary'
                      : 'bg-theme-surface border border-theme-border'
                  }`}
                  role="switch"
                  aria-checked={notifications}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      notifications ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-theme-border bg-theme-bg hover:bg-theme-surface text-theme-text-muted hover:text-theme-text-primary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className={`px-4 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer ${
                isSubmitDisabled
                  ? 'bg-theme-bg border border-theme-border text-theme-text-muted opacity-50 cursor-not-allowed'
                  : 'bg-theme-accent-primary text-black hover:opacity-90 active:scale-95'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {mode === 'edit'
                  ? 'Save Changes'
                  : isTeam
                  ? 'Deploy Team'
                  : 'Deploy Agent'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
