import { useState, useEffect } from "react";
import {
  User,
  Mail,
  Briefcase,
  FileText,
  Check,
  ShieldCheck,
  Sparkles,
  GitCommit,
  UserPlus,
  Trash2,
  Users,
  CheckCircle2,
} from "lucide-react";
import { useUserStore, UserProfile } from "../../store/userStore";
import { useToastStore } from "../../store/toastStore";

export function ProfileSettings() {
  const { users, activeUserId, getActiveUser, updateUser, addUser, deleteUser, switchUser } =
    useUserStore();
  const { addToast } = useToastStore();

  const activeUser = getActiveUser();

  const [formData, setFormData] = useState<UserProfile>(activeUser);
  const [saved, setSaved] = useState(false);

  // Sync form when switching users
  useEffect(() => {
    setFormData(activeUser);
  }, [activeUserId, activeUser]);

  const handleSave = () => {
    try {
      updateUser(activeUser.id, {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        bio: formData.bio,
        customInstructions: formData.customInstructions,
      });

      setSaved(true);
      addToast({
        title: "Profile Saved",
        description: `Profile for "${formData.name}" has been saved to settings.`,
        type: "success",
      });
      setTimeout(() => setSaved(false), 2000);
    } catch {
      addToast({
        title: "Save Failed",
        description: "Could not save profile changes.",
        type: "error",
      });
    }
  };

  const handleCreateUser = () => {
    const newUser = addUser({
      name: "New Developer",
      email: "developer@local",
      role: "Software Engineer",
      bio: "Local developer workspace",
      customInstructions: "Prefer concise explanations and clean, modular code.",
    });
    addToast({
      title: "User Profile Created",
      description: `Created profile for "${newUser.name}".`,
      type: "success",
    });
  };

  const handleDeleteUser = (id: string, name: string) => {
    if (users.length <= 1) {
      addToast("Cannot delete the only user profile.", "warning");
      return;
    }
    deleteUser(id);
    addToast(`Deleted profile for "${name}".`, "info");
  };

  const getInitials = (name: string) => {
    return (
      name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "DEV"
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Users className="w-4 h-4 text-[#58a6ff]" />
          <span>Multi-User Profiles & Developer Identity</span>
        </h2>
        <p className="text-[#8b949e]">
          Manage multiple user accounts on this machine, switch active profiles, and configure personal agent instructions.
        </p>
      </div>

      {/* User Profiles Switcher */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
            Machine Users ({users.length})
          </label>
          <button
            onClick={handleCreateUser}
            className="flex items-center space-x-1 px-2.5 py-1 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg border border-[#30363d] transition text-[11px]"
          >
            <UserPlus className="w-3.5 h-3.5 text-blue-400" />
            <span>Add User Profile</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {users.map((user) => {
            const isActive = user.id === activeUserId;
            return (
              <div
                key={user.id}
                onClick={() => switchUser(user.id)}
                className={`p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                  isActive
                    ? "bg-[#1f6feb]/15 border-blue-500 shadow-sm shadow-blue-500/10"
                    : "bg-[#0d1117] border-[#30363d] hover:border-[#8b949e]"
                }`}
              >
                <div className="flex items-center space-x-3 truncate mr-2">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow">
                    {getInitials(user.name)}
                  </div>
                  <div className="truncate">
                    <div className="font-semibold text-white text-xs truncate flex items-center space-x-1.5">
                      <span>{user.name}</span>
                      {isActive && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                    </div>
                    <div className="text-[10px] text-[#8b949e] truncate">{user.email}</div>
                  </div>
                </div>

                {users.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteUser(user.id, user.name);
                    }}
                    className="p-1 rounded hover:bg-red-950/40 text-[#8b949e] hover:text-red-400 transition"
                    title="Delete this user profile"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Profile Editor Card */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-5">
        <div className="flex items-center space-x-4 pb-4 border-b border-[#30363d]">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg flex-shrink-0">
            {getInitials(formData.name)}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <span>{formData.name || "Anonymous Developer"}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Active User Profile</span>
              </span>
            </h3>
            <p className="text-[#8b949e] text-[11px]">{formData.role || "Developer"}</p>
          </div>
        </div>

        {/* Input Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="flex items-center space-x-1.5 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
              <User className="w-3.5 h-3.5" />
              <span>Full Name / Display Name</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Tyson Goulding"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#58a6ff] outline-none transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center space-x-1.5 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
              <Mail className="w-3.5 h-3.5" />
              <span>Email Address</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="e.g. tyson@example.com"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#58a6ff] outline-none transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center space-x-1.5 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
              <Briefcase className="w-3.5 h-3.5" />
              <span>Developer Role / Title</span>
            </label>
            <input
              type="text"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="e.g. Principal Systems Architect"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#58a6ff] outline-none transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center space-x-1.5 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
              <GitCommit className="w-3.5 h-3.5" />
              <span>Bio / Status</span>
            </label>
            <input
              type="text"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="e.g. Building intelligent local and desktop agentic workflows"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#58a6ff] outline-none transition"
            />
          </div>
        </div>
      </div>

      {/* Custom Agent Instructions */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="flex items-center space-x-1.5 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
            <span>Custom Instructions for AI Agents</span>
          </label>
          <span className="text-[10px] text-[#8b949e]">Scoped to active user</span>
        </div>
        <p className="text-[11px] text-[#8b949e]">
          Specify personal rules, code formatting guidelines, or constraints that all agents adhere to when responding to your prompts.
        </p>
        <textarea
          rows={4}
          value={formData.customInstructions}
          onChange={(e) => setFormData({ ...formData, customInstructions: e.target.value })}
          placeholder="e.g. Prefer concise explanations and clean, modular code. Respect project boundaries..."
          className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-white focus:border-[#58a6ff] outline-none transition font-mono text-xs resize-none"
        />
      </div>

      {/* Action Footer */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          className={`flex items-center space-x-2 px-5 py-2 rounded-lg font-medium transition shadow-sm ${
            saved
              ? "bg-emerald-600 text-white"
              : "bg-[#1f6feb] hover:bg-blue-600 text-white"
          }`}
        >
          {saved ? <Check className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
          <span>{saved ? "Saved to Settings" : "Save Profile"}</span>
        </button>
      </div>
    </div>
  );
}
