import React, { useState } from 'react';
import {
  Settings,
  ChevronsRight,
  ChevronLeft,
  Maximize2,
  Plus,
  Bot,
  Users,
  X,
  Network,
  Stethoscope,
  GraduationCap,
} from 'lucide-react';
import { getVncUrl, DEFAULT_EC2_HOST } from '../../lib/vnc';
import { useUserStore } from '../../store/userStore';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
}

interface RightPanelProps {
  isOpen?: boolean;
  onClose: () => void;
  agentName: string;
  agentRole: string;
  onOpenScreenModal: () => void;
  isTeam?: boolean;
  teamMembers?: TeamMember[];
  availableAgents?: TeamMember[];
  onAddTeamMember?: (agentId: string) => void;
  onRemoveTeamMember?: (agentId: string) => void;
  missionObjective?: string;
  description?: string;
  activeTab?: string;
  displayNumber?: number;
  vncPort?: number;
  vmHost?: string;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  isOpen = true,
  onClose,
  agentName,
  agentRole,
  onOpenScreenModal,
  isTeam = false,
  teamMembers = [],
  availableAgents = [],
  onAddTeamMember,
  onRemoveTeamMember,
  missionObjective = '',
  description = '',
  activeTab,
  displayNumber: propDisplayNumber,
  vncPort: propVncPort,
  vmHost: propVmHost,
}) => {
  const { activeUserId, getActiveUser } = useUserStore();
  const currentUser = getActiveUser();
  const [workflows, setWorkflows] = useState([
    { id: 'wf-1', title: 'Automated Research Pipeline', desc: 'Browse Google & summarize web insights', category: 'Web' },
    { id: 'wf-2', title: 'Code Refactor & Test Matrix', desc: 'Execute builds & closed-loop verification', category: 'Dev' },
    { id: 'wf-3', title: 'System Diagnostics & Health Check', desc: 'Monitor VM metrics and audit ledger', category: 'Ops' },
  ]);
  const [isAddingWorkflow, setIsAddingWorkflow] = useState(false);
  const [newWorkflowTitle, setNewWorkflowTitle] = useState('');

  const [viewMode, setViewMode] = useState<'workflows' | 'settings'>('workflows');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [botDescription, setBotDescription] = useState(
    missionObjective || description || 'Autonomous cloud agent running tasks in the cloud VM environment.'
  );

  const getAgentAvatar = (id: string) => {
    if (id === 'netops') return <Network className="w-3.5 h-3.5 text-sky-300" />;
    if (id === 'netdoctor') return <Stethoscope className="w-3.5 h-3.5 text-rose-300" />;
    if (id === 'nettrainer') return <GraduationCap className="w-3.5 h-3.5 text-emerald-300" />;
    return <Bot className="w-3.5 h-3.5 text-purple-300" />;
  };

  const availableCandidates = availableAgents.filter(
    (agent) => !teamMembers.some((m) => m.id === agent.id)
  );

  return (
    <aside className="w-full bg-theme-surface flex flex-col h-full select-none overflow-hidden">
      {/* Header */}
      <div className="h-11 px-3 border-b border-theme-border flex items-center justify-between text-xs text-theme-text-muted shrink-0">
        {viewMode === 'settings' ? (
          <>
            <button
              onClick={() => setViewMode('workflows')}
              className="flex items-center gap-1 hover:text-theme-text-primary transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <span className="font-semibold text-theme-text-primary">
              {isTeam ? 'Team Settings' : 'Agent Settings'}
            </span>
            <button
              onClick={onClose}
              className="p-1 hover:text-theme-text-primary transition-colors cursor-pointer"
              title="Collapse panel"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {/* Settings Button */}
            <button
              onClick={() => setViewMode('settings')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-text-primary hover:border-theme-text-muted text-[11px] font-medium transition-all shadow-xs active:scale-95 cursor-pointer"
              title={isTeam ? 'Team Settings' : 'Agent Settings'}
            >
              <span>{isTeam ? 'Team Settings' : 'Agent Settings'}</span>
              <Settings className="w-3 h-3 text-theme-text-muted" />
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:text-theme-text-primary transition-colors cursor-pointer"
              title="Collapse panel"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto scrollbar-none">
        {viewMode === 'workflows' ? (
          <div className="p-4 space-y-6">
            {/* If Team: Display Members List & Visual 6-Seat Slots */}
            {isTeam ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-theme-text-primary">
                      Members
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                        teamMembers.length >= 6
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-theme-bg text-theme-text-muted border-theme-border'
                      }`}
                    >
                      {teamMembers.length}/6 Seats
                    </span>
                  </div>

                  {teamMembers.length < 6 ? (
                    <button
                      onClick={() => setIsAddingMember(!isAddingMember)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-theme-bg border border-theme-border hover:border-theme-accent-primary text-theme-text-primary hover:bg-theme-surface transition-all shadow-xs active:scale-95 cursor-pointer"
                      title="Add agent to team"
                    >
                      <Plus className="w-3 h-3 text-theme-accent-primary" />
                      <span>Add</span>
                    </button>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-medium px-1.5 py-0.5 bg-amber-500/10 rounded border border-amber-500/20">
                      Seats Full
                    </span>
                  )}
                </div>

                {/* 6-Seat Visual Slots Indicator */}
                <div className="grid grid-cols-6 gap-1 py-0.5">
                  {Array.from({ length: 6 }).map((_, idx) => {
                    const isOccupied = idx < teamMembers.length;
                    return (
                      <div
                        key={idx}
                        title={
                          isOccupied
                            ? `Seat ${idx + 1}: ${teamMembers[idx]?.name}`
                            : `Seat ${idx + 1}: Available`
                        }
                        className={`h-1.5 rounded-full transition-all ${
                          isOccupied
                            ? 'bg-theme-accent-primary'
                            : 'bg-theme-bg border border-theme-border/70'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Add Member Dropdown Panel */}
                {isAddingMember && (
                  <div className="p-2.5 rounded-xl bg-theme-bg border border-theme-border space-y-2 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-theme-text-primary px-0.5">
                      <span>Available Agents ({availableCandidates.length})</span>
                      <button
                        onClick={() => setIsAddingMember(false)}
                        className="p-1 rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
                      {availableCandidates.length === 0 ? (
                        <p className="text-[11px] text-theme-text-muted text-center py-3">
                          All agents are already in this team
                        </p>
                      ) : (
                        availableCandidates.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => {
                              onAddTeamMember?.(agent.id);
                              if (teamMembers.length + 1 >= 6) {
                                setIsAddingMember(false);
                              }
                            }}
                            className="w-full flex items-center justify-between p-2 rounded-lg bg-theme-surface hover:bg-theme-surface/80 border border-theme-border text-left transition-all group active:scale-98 cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-lg bg-theme-bg border border-theme-border flex items-center justify-center shrink-0">
                                {getAgentAvatar(agent.id)}
                              </div>
                              <div className="min-w-0">
                                <span className="block text-xs font-medium text-theme-text-primary truncate">
                                  {agent.name}
                                </span>
                                <span className="block text-[10px] text-theme-text-muted truncate">
                                  {agent.role}
                                </span>
                              </div>
                            </div>
                            <Plus className="w-3.5 h-3.5 text-theme-text-muted group-hover:text-theme-accent-primary shrink-0 ml-1.5" />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Current Members List */}
                <div className="space-y-1.5">
                  {teamMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-2 rounded-xl bg-theme-bg border border-theme-border hover:border-theme-text-muted/40 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-theme-surface border border-theme-border flex items-center justify-center shrink-0">
                          {getAgentAvatar(member.id)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-theme-text-primary truncate">
                              {member.name}
                            </span>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          </div>
                          <span className="block text-[10px] text-theme-text-muted truncate">
                            {member.role}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onRemoveTeamMember?.(member.id)}
                        className="p-1 rounded-md text-theme-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-70 group-hover:opacity-100 cursor-pointer"
                        title={`Remove ${member.name} from team`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {teamMembers.length === 0 && (
                    <div className="p-3.5 text-center rounded-xl bg-theme-bg/40 border border-dashed border-theme-border text-theme-text-muted text-xs">
                      No members currently assigned. Click &quot;Add&quot; to add up to 6 members.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Agent Screen Box (Only shown for individual agents) */
              (() => {
                const displayNumber = propDisplayNumber ?? 1;
                const vmHost = propVmHost || currentUser.vmHost || DEFAULT_EC2_HOST;
                const agentPort = propVncPort || (6079 + displayNumber);
                const vncUrl = getVncUrl(displayNumber, { host: vmHost, port: agentPort, scale: 'fit' });
                return (
                  <div className="space-y-1.5">
                    <div
                      onClick={onOpenScreenModal}
                      className="group relative w-full aspect-[16/10] bg-black rounded-xl border border-theme-border overflow-hidden cursor-pointer shadow-sm hover:border-theme-accent-primary transition-all flex flex-col justify-between"
                    >
                      {isOpen && activeTab !== 'screen' ? (
                        <iframe
                          key={vncUrl}
                          src={vncUrl}
                          title={`${agentName}'s Live Display`}
                          className="w-full h-full border-none pointer-events-none"
                          sandbox="allow-scripts allow-same-origin"
                        />
                      ) : isOpen && activeTab === 'screen' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950/90 p-4 text-center">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping mb-2.5" />
                          <span className="text-xs font-semibold text-emerald-400">Live on Main Canvas</span>
                          <span className="text-[10px] text-zinc-400 mt-1">Full interactive workspace active</span>
                        </div>
                      ) : null}

                      {/* Top-right expand button */}
                      <div className="absolute top-2 right-2 z-10">
                        <span className="px-2 py-1 rounded-md bg-black/70 text-white/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-mono border border-white/10 backdrop-blur-xs">
                          <Maximize2 className="w-3 h-3" />
                          <span>{activeTab === 'screen' ? 'Active' : 'Expand'}</span>
                        </span>
                      </div>
                    </div>
                    <span className="block text-center text-[11px] text-theme-text-muted">
                      {agentName}&apos;s live screen {activeTab === 'screen' ? '(Active on main canvas)' : '(Click to open full view)'}
                    </span>
                  </div>
                );
              })()
            )}

            {/* Workflows Section */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-theme-text-primary">
                  Workflows
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingWorkflow(!isAddingWorkflow)}
                  className="flex items-center justify-center w-5 h-5 rounded-md bg-theme-bg border border-theme-border hover:border-theme-accent-primary text-theme-text-muted hover:text-theme-text-primary transition-all shadow-xs cursor-pointer active:scale-95"
                  title="Add Workflow"
                >
                  <Plus className="w-3.5 h-3.5 text-theme-accent-primary" />
                </button>
              </div>

              {isAddingWorkflow && (
                <div className="p-2.5 rounded-xl bg-theme-bg border border-theme-border space-y-2 animate-in fade-in zoom-in-95">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-theme-text-primary">
                    <span>New Workflow</span>
                    <button
                      type="button"
                      onClick={() => setIsAddingWorkflow(false)}
                      className="p-0.5 rounded text-theme-text-muted hover:text-theme-text-primary cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newWorkflowTitle}
                    onChange={(e) => setNewWorkflowTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newWorkflowTitle.trim()) {
                        setWorkflows((prev) => [
                          ...prev,
                          {
                            id: `wf-${Date.now()}`,
                            title: newWorkflowTitle.trim(),
                            desc: 'Custom automated agent workflow',
                            category: 'Custom',
                          },
                        ]);
                        setNewWorkflowTitle('');
                        setIsAddingWorkflow(false);
                      }
                    }}
                    placeholder="Workflow name (e.g. Test Run)..."
                    className="w-full bg-theme-surface border border-theme-border text-theme-text-primary text-xs px-2.5 py-1.5 rounded-lg outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/60"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsAddingWorkflow(false)}
                      className="px-2 py-1 rounded-md text-[11px] text-theme-text-muted hover:text-theme-text-primary cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (newWorkflowTitle.trim()) {
                          setWorkflows((prev) => [
                            ...prev,
                            {
                              id: `wf-${Date.now()}`,
                              title: newWorkflowTitle.trim(),
                              desc: 'Custom automated agent workflow',
                              category: 'Custom',
                            },
                          ]);
                          setNewWorkflowTitle('');
                          setIsAddingWorkflow(false);
                        }
                      }}
                      className="px-2.5 py-1 rounded-md bg-theme-accent-primary text-black font-semibold text-[11px] hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    className="flex items-start justify-between gap-2 p-2 rounded-lg bg-theme-bg/30 hover:bg-theme-bg/70 border border-theme-border/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className="text-xs font-mono font-medium text-theme-text-primary truncate">
                          {wf.title}
                        </span>
                      </div>
                      <span className="block text-[10px] text-theme-text-muted truncate mt-0.5 pl-3">
                        {wf.desc}
                      </span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-theme-bg border border-theme-border text-theme-text-muted shrink-0 font-mono">
                      {wf.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Settings View */
          <div className="p-4 space-y-5">
            {/* Big Squircle Avatar */}
            <div className="flex justify-center pt-2">
              <div
                className={`w-16 h-16 rounded-3xl flex items-center justify-center shadow-sm border ${
                  isTeam
                    ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                    : 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                }`}
              >
                {isTeam ? <Users className="w-8 h-8" /> : <Bot className="w-8 h-8" />}
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-theme-text-muted font-medium">
                  {isTeam ? 'Team Name' : 'Name'}
                </label>
                <input
                  type="text"
                  defaultValue={agentName}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-theme-text-muted font-medium">Label (optional)</label>
                <input
                  type="text"
                  defaultValue={agentRole}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-theme-accent-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-theme-text-muted font-medium">
                  {isTeam ? 'Mission Objective' : 'Description'}
                </label>
                <textarea
                  rows={5}
                  value={botDescription}
                  onChange={(e) => setBotDescription(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border rounded-lg p-2.5 text-[11px] leading-relaxed text-theme-text-primary outline-none focus:border-theme-accent-primary resize-none"
                />
              </div>

              {/* Notifications Toggle */}
              <div className="pt-2 border-t border-theme-border flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="font-medium text-theme-text-primary block">
                    Notifications
                  </span>
                  <span className="text-[10px] text-theme-text-muted block">
                    {isTeam
                      ? 'Get notified when this Team finishes or needs input'
                      : 'Get notified when this Bot finishes or needs input'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    notificationsEnabled
                      ? 'bg-theme-accent-primary'
                      : 'bg-theme-bg border border-theme-border'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      notificationsEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
