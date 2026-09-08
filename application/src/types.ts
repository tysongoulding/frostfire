export type ThemeName = 'frostfire' | 'frost' | 'fire';
export type ThemeMode = 'dark' | 'light' | 'system';
export type DevicePreview =
  | 'fluid'
  | 'desktop'
  | 'desktop-windows'
  | 'desktop-linux'
  | 'desktop-mac'
  | 'tablet'
  | 'tablet-android'
  | 'tablet-ios'
  | 'phone'
  | 'phone-android'
  | 'phone-ios';
export type ActiveTab = 'chat' | 'screen' | 'agents' | 'marketplace' | 'settings';

export interface AgentCard {
  id: string;
  name: string;
  role: string;
  accentClass: string;
  badge?: string;
  isTeam?: boolean;
}

export interface ThreadItem {
  id: string;
  title: string;
  roleTag?: string;
  timestamp: string;
  preview: string;
  accentClass: string;
}

export interface SidebarSection {
  id: string;
  title: string;
  isPinnedSection?: boolean;
  isStarSection?: boolean;
  isDefaultSection?: boolean;
  isUnassignedSection?: boolean;
  isCollapsed?: boolean;
}

export interface SidebarItem {
  id: string;
  title: string;
  roleTag?: string;
  preview?: string;
  timestamp?: string;
  accentClass: string;
  isTeam?: boolean;
  memberCount?: number;
  isPinned?: boolean;
  isStarred?: boolean;
  isUnread?: boolean;
  isHidden?: boolean;
  sectionId?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
  toolCalls?: string[];
}

export interface ClusterNode {
  id: string;
  region: string;
  status: 'Active' | 'Warning' | 'Standby';
  load: number;
  latencyMs: number;
  memory: string;
}

export interface AgentEntity {
  id?: string;
  name: string;
  role: string;
  description?: string;
  notifications?: boolean;
  isTeam?: boolean;
  memberIds?: string[];
  missionObjective?: string;
  displayNumber?: number;
  vncPort?: number;
  vmHost?: string;
  status?: string;
  vncUrl?: string;
}

export interface AgentSessionInfo {
  id: string; // agt_<ulid>
  agent_id?: string;
  name?: string;
  role?: string;
  description?: string;
  display_number: number;
  display_slot?: number;
  vnc_port: number;
  rfb_port?: number;
  cdp_port?: number;
  vm_host: string;
  status: string;
  team_id?: string | null;
  created_at?: string;
  updated_at?: string;
}
