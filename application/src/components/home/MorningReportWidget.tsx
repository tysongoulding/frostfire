import { useState } from "react";
import {
  Calendar,
  Mail,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Video,
  Plus,
  ArrowRight,
  Hash,
  ExternalLink,
  Layers,
  X,
} from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";
import { useUiStore } from "../../store/uiStore";
import { useRhoEngine } from "../../hooks/useRhoEngine";

export interface CalendarEvent {
  id: string;
  source: "google" | "microsoft";
  title: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  attendeesCount: number;
  category: "work" | "review" | "standup" | "personal";
}

export interface EmailItem {
  id: string;
  source: "gmail" | "outlook";
  sender: string;
  senderEmail: string;
  subject: string;
  preview: string;
  receivedAt: string;
  urgency: "high" | "medium" | "low";
  isUnread: boolean;
}

export interface ChatMessageItem {
  id: string;
  source: "slack" | "teams" | "google-chat";
  channel: string;
  sender: string;
  message: string;
  timestamp: string;
  isMention: boolean;
}

export interface MorningReportWidgetProps {
  isWorkbench?: boolean;
  onDismiss?: () => void;
  defaultOpen?: boolean;
}

export function MorningReportWidget({ isWorkbench, onDismiss, defaultOpen = true }: MorningReportWidgetProps = {}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "inbox" | "chat">("overview");

  const [events] = useState<CalendarEvent[]>([]);
  const [emails] = useState<EmailItem[]>([]);
  const [chats] = useState<ChatMessageItem[]>([]);

  const { addUserMessage } = useSessionStore();
  const { setActiveView, setActiveCustomiseTab } = useUiStore();
  const { prompt } = useRhoEngine();

  const handleNavigateToMcp = () => {
    setActiveView("customise");
    setActiveCustomiseTab("mcps");
  };

  const handleSynthesizeBriefing = async () => {
    const promptText =
      "Synthesize my morning report: summarize today's calendar schedule (Google & Outlook), review priority unread emails (Gmail & Outlook), check critical team mentions in Chat (Slack & Teams), and formulate my top 3 focus priorities for today.";
    addUserMessage(promptText);
    await prompt(promptText);
  };

  const unreadCount = emails.filter((e) => e.isUnread).length;
  const mentionsCount = chats.filter((c) => c.isMention).length;

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "google":
      case "gmail":
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">Google</span>;
      case "microsoft":
      case "outlook":
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">Microsoft 365</span>;
      case "slack":
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Slack</span>;
      case "teams":
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Teams</span>;
      case "google-chat":
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Google Chat</span>;
      default:
        return null;
    }
  };

  return (
    <div className={`w-full bg-[#18181b] border border-[#2e2e34] ${isWorkbench ? "rounded-xl" : "rounded-2xl shadow-2xl"} overflow-hidden transition-all duration-200`}>
      {/* Header Bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-3 bg-[#18181b] border-b border-[#2e2e34] flex items-center justify-between cursor-pointer hover:bg-[#27272a] transition select-none"
      >
        <div className="flex items-center space-x-3">
          <div className="p-1.5 rounded-lg bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-white text-xs">Morning Report</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-[#58a6ff] border border-blue-500/30 font-medium">
              {events.length} Meetings
            </span>
            {unreadCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium">
                {unreadCount} Unread
              </span>
            )}
            {mentionsCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30 font-medium">
                {mentionsCount} Mentions
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSynthesizeBriefing();
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-[11px] font-medium shadow transition"
            title="Ask agent to generate a synthesized daily plan"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Synthesize</span>
          </button>

          <div className="text-[#8b949e] p-1 rounded hover:bg-[#27272a]">
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>

          {onDismiss && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              className="text-[#8b949e] p-1 rounded hover:text-white hover:bg-[#27272a] transition"
              title="Remove from top-right view"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expandable Body */}
      {isOpen && (
        <div className="p-4 space-y-4 animate-in fade-in duration-150">
          {/* Subtabs Navigation */}
          <div className="flex items-center justify-between border-b border-[#2e2e34] pb-2">
            <div className="flex space-x-1">
              {(
                [
                  { id: "overview", label: "Overview", icon: Layers },
                  { id: "schedule", label: `Schedule (${events.length})`, icon: Calendar },
                  { id: "inbox", label: `Inbox (${unreadCount})`, icon: Mail },
                  { id: "chat", label: `Chat (${chats.length})`, icon: MessageSquare },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                      isSelected
                        ? "bg-[#27272a] text-white border border-[#2e2e34]"
                        : "text-[#8b949e] hover:text-white"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-blue-400" : "text-[#8b949e]"}`} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Direct Link to MCP Customisation */}
            <button
              onClick={handleNavigateToMcp}
              className="flex items-center space-x-1 text-[11px] text-[#58a6ff] hover:text-blue-400 font-medium transition"
              title="Add or configure Google Workspace, Microsoft 365, Slack, or Teams MCP tools"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add / Manage Tools</span>
            </button>
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Schedule Summary Card */}
                <div
                  onClick={() => setActiveTab("schedule")}
                  className="p-3 bg-[#121214] border border-[#2e2e34] rounded-xl hover:border-blue-500/50 cursor-pointer transition space-y-2 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-white">
                      <Calendar className="w-3.5 h-3.5 text-blue-400" />
                      <span>Schedule</span>
                    </div>
                    <span className="text-[10px] text-blue-400 font-medium">{events.length} Events</span>
                  </div>
                  <p className="text-[11px] text-[#8b949e]">
                    {events.length > 0 ? (
                      <>Next: <strong className="text-white">{events[0].title}</strong> at {events[0].startTime}</>
                    ) : (
                      "No upcoming events scheduled."
                    )}
                  </p>
                </div>

                {/* Inbox Summary Card */}
                <div
                  onClick={() => setActiveTab("inbox")}
                  className="p-3 bg-[#121214] border border-[#2e2e34] rounded-xl hover:border-amber-500/50 cursor-pointer transition space-y-2 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-white">
                      <Mail className="w-3.5 h-3.5 text-amber-400" />
                      <span>Inbox</span>
                    </div>
                    <span className="text-[10px] text-amber-400 font-medium">{unreadCount} Unread</span>
                  </div>
                  <p className="text-[11px] text-[#8b949e] truncate">
                    {emails.length > 0 ? (
                      <>From: <strong className="text-white">{emails[0].sender}</strong> – {emails[0].subject}</>
                    ) : (
                      "Inbox is clear."
                    )}
                  </p>
                </div>

                {/* Chat Summary Card */}
                <div
                  onClick={() => setActiveTab("chat")}
                  className="p-3 bg-[#121214] border border-[#2e2e34] rounded-xl hover:border-purple-500/50 cursor-pointer transition space-y-2 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-white">
                      <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                      <span>Team Chat</span>
                    </div>
                    <span className="text-[10px] text-purple-400 font-medium">{mentionsCount} Mentions</span>
                  </div>
                  <p className="text-[11px] text-[#8b949e] truncate">
                    {chats.length > 0 ? (
                      <>{chats[0].sender}: <strong className="text-white">{chats[0].channel}</strong></>
                    ) : (
                      "No unread mentions."
                    )}
                  </p>
                </div>
              </div>

              {/* Integrations Banner */}
              <div className="p-3 bg-[#121214] border border-[#2e2e34] rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs text-[#8b949e]">
                  <span>Connected Hubs:</span>
                  <div className="flex space-x-1.5">
                    {getSourceBadge("google")}
                    {getSourceBadge("microsoft")}
                    {getSourceBadge("slack")}
                  </div>
                </div>

                <button
                  onClick={handleNavigateToMcp}
                  className="flex items-center space-x-1 text-[11px] text-[#58a6ff] hover:text-white transition"
                >
                  <span>Configure MCP Connectors</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: SCHEDULE (Google & Microsoft 365 Calendars) */}
          {activeTab === "schedule" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                  Upcoming Meetings & Events
                </span>
                <button
                  onClick={handleNavigateToMcp}
                  className="flex items-center space-x-1 text-[11px] text-[#58a6ff] hover:text-white transition"
                >
                  <Plus className="w-3 h-3" />
                  <span>Connect Google / Outlook Calendar</span>
                </button>
              </div>

              {events.length === 0 ? (
                <div className="py-8 px-4 border border-dashed border-[#2e2e34] rounded-xl text-center text-[#8b949e] text-xs">
                  No upcoming meetings or events scheduled.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((evt) => (
                    <div
                      key={evt.id}
                      className="p-3 bg-[#121214] border border-[#2e2e34] rounded-xl hover:border-[#3f3f46] transition flex items-center justify-between"
                    >
                      <div className="space-y-1 truncate mr-2">
                        <div className="flex items-center space-x-2">
                          {getSourceBadge(evt.source)}
                          <span className="text-xs font-semibold text-white truncate">{evt.title}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] text-[#8b949e]">
                          <span className="flex items-center space-x-1 text-blue-400 font-mono">
                            <Clock className="w-3 h-3" />
                            <span>
                              {evt.startTime} – {evt.endTime}
                            </span>
                          </span>
                          <span>•</span>
                          <span>{evt.attendeesCount} attendees</span>
                        </div>
                      </div>

                      {evt.meetingLink && (
                        <a
                          href={evt.meetingLink}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-medium transition flex-shrink-0"
                        >
                          <Video className="w-3.5 h-3.5" />
                          <span>Join Call</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: INBOX (Gmail & Microsoft Outlook) */}
          {activeTab === "inbox" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                  Priority Email Inbox
                </span>
                <button
                  onClick={handleNavigateToMcp}
                  className="flex items-center space-x-1 text-[11px] text-[#58a6ff] hover:text-white transition"
                >
                  <Plus className="w-3 h-3" />
                  <span>Connect Gmail / Outlook Account</span>
                </button>
              </div>

              {emails.length === 0 ? (
                <div className="py-8 px-4 border border-dashed border-[#2e2e34] rounded-xl text-center text-[#8b949e] text-xs">
                  No unread or priority emails.
                </div>
              ) : (
                <div className="space-y-2">
                  {emails.map((mail) => (
                    <div
                      key={mail.id}
                      className={`p-3 bg-[#121214] border rounded-xl hover:border-[#3f3f46] transition space-y-1.5 ${
                        mail.isUnread ? "border-amber-500/40 bg-amber-950/10" : "border-[#2e2e34]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          {getSourceBadge(mail.source)}
                          {mail.isUnread && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
                          <span className="font-semibold text-white text-xs truncate">{mail.sender}</span>
                        </div>
                        <span className="text-[10px] text-[#8b949e] flex-shrink-0 font-mono">{mail.receivedAt}</span>
                      </div>

                      <div className="text-xs font-medium text-[#c9d1d9] truncate">{mail.subject}</div>

                      <p className="text-[11px] text-[#8b949e] line-clamp-1">{mail.preview}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CHAT (Slack, Microsoft Teams, Google Chat) */}
          {activeTab === "chat" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                  Team Channels & Direct Mentions
                </span>
                <button
                  onClick={handleNavigateToMcp}
                  className="flex items-center space-x-1 text-[11px] text-[#58a6ff] hover:text-white transition"
                >
                  <Plus className="w-3 h-3" />
                  <span>Connect Slack / Teams / Google Chat</span>
                </button>
              </div>

              {chats.length === 0 ? (
                <div className="py-8 px-4 border border-dashed border-[#2e2e34] rounded-xl text-center text-[#8b949e] text-xs">
                  No active channel discussions or mentions.
                </div>
              ) : (
                <div className="space-y-2">
                  {chats.map((chat) => (
                    <div
                      key={chat.id}
                      className={`p-3 bg-[#121214] border rounded-xl hover:border-[#3f3f46] transition space-y-1.5 ${
                        chat.isMention ? "border-purple-500/40 bg-purple-950/10" : "border-[#2e2e34]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          {getSourceBadge(chat.source)}
                          <span className="flex items-center space-x-1 text-xs font-semibold text-white truncate">
                            <Hash className="w-3 h-3 text-[#8b949e]" />
                            <span>{chat.channel}</span>
                          </span>
                          {chat.isMention && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30">
                              @Mention
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#8b949e] font-mono">{chat.timestamp}</span>
                      </div>

                      <div className="text-[11px] text-[#c9d1d9]">
                        <span className="font-semibold text-white mr-1.5">{chat.sender}:</span>
                        <span>{chat.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
