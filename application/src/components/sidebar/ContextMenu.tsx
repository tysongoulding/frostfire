import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Star,
  FolderPlus,
  Bell,
  Check,
  Edit2,
  Copy,
  EyeOff,
  Trash2,
  ChevronRight,
  Plus,
} from 'lucide-react';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuItemTarget {
  id: string;
  title: string;
  isPinned?: boolean;
  isStarred?: boolean;
  isUnread?: boolean;
  isTeam?: boolean;
  sectionId?: string;
}

export interface SectionOption {
  id: string;
  title: string;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: ContextMenuPosition;
  target: ContextMenuItemTarget | null;
  sections: SectionOption[];
  onClose: () => void;
  onTogglePin: (id: string) => void;
  onMoveToSection: (id: string, sectionId: string) => void;
  onCreateAndMoveToSection: (id: string, newSectionTitle: string) => void;
  onToggleUnread: (id: string) => void;
  onEditProfile: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCopyConversationId: (id: string) => void;
  onHideFromSidebar: (id: string) => void;
  onDelete: (id: string) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  position,
  target,
  sections,
  onClose,
  onTogglePin,
  onMoveToSection,
  onCreateAndMoveToSection,
  onToggleUnread,
  onEditProfile,
  onDuplicate,
  onCopyConversationId,
  onHideFromSidebar,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [isCreatingNewSection, setIsCreatingNewSection] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Position adjustment to avoid screen edge clipping
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: position.x, y: position.y });

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    if (adjustedX + menuRect.width > viewportWidth - 12) {
      adjustedX = Math.max(12, viewportWidth - menuRect.width - 12);
    }
    if (adjustedY + menuRect.height > viewportHeight - 12) {
      adjustedY = Math.max(12, viewportHeight - menuRect.height - 12);
    }

    setCoords({ x: adjustedX, y: adjustedY });
    setShowMoveSubmenu(false);
    setIsCreatingNewSection(false);
    setNewSectionName('');
  }, [isOpen, position]);

  // Click outside to dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !target) return null;

  const handleCopyId = () => {
    onCopyConversationId(target.id);
    setCopiedNotification(true);
    setTimeout(() => {
      setCopiedNotification(false);
      onClose();
    }, 900);
  };

  const handleCreateSectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    onCreateAndMoveToSection(target.id, newSectionName.trim());
    onClose();
  };

  const isStarred = Boolean(target.isStarred ?? target.isPinned);
  const canOpenSubmenuRight =
    coords.x + 210 + 190 <= (typeof window !== 'undefined' ? window.innerWidth : 1200);

  return createPortal(
    <div
      ref={menuRef}
      style={{ top: `${coords.y}px`, left: `${coords.x}px` }}
      className="fixed z-[9999] min-w-[210px] bg-theme-surface/98 border border-theme-border rounded-xl shadow-2xl py-1.5 px-1 text-xs text-theme-text-primary backdrop-blur-md animate-in fade-in zoom-in-95 select-none"
    >
      {/* 1. Star / Unstar */}
      <button
        onClick={() => {
          onTogglePin(target.id);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
      >
        <Star
          className={`w-3.5 h-3.5 transition-colors ${
            isStarred
              ? 'text-amber-400 fill-amber-400'
              : 'text-theme-text-muted group-hover:text-amber-400'
          }`}
        />
        <span>{isStarred ? 'Unstar' : 'Star'}</span>
      </button>

      {/* 2. Move to new section (with Submenu) */}
      <div
        className="relative"
        onMouseEnter={() => setShowMoveSubmenu(true)}
        onMouseLeave={() => setShowMoveSubmenu(false)}
      >
        <button
          onClick={() => setShowMoveSubmenu(!showMoveSubmenu)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <FolderPlus className="w-3.5 h-3.5 text-theme-text-muted group-hover:text-theme-text-primary" />
            <span>Move to section</span>
          </div>
          <ChevronRight className="w-3 h-3 text-theme-text-muted" />
        </button>

        {/* Nested Move Submenu */}
        {showMoveSubmenu && (
          <div
            className={`absolute ${
              canOpenSubmenuRight ? 'left-full ml-1' : 'right-full mr-1'
            } top-0 min-w-[190px] bg-theme-surface/98 border border-theme-border rounded-xl shadow-2xl p-1 text-xs text-theme-text-primary backdrop-blur-md space-y-0.5 animate-in fade-in zoom-in-95 z-[10000]`}
          >
            <div className="px-2 py-1 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">
              Sections
            </div>

            {sections.map((sec) => {
              const isCurrent = sec.id === target.sectionId;
              return (
                <button
                  key={sec.id}
                  disabled={isCurrent}
                  onClick={() => {
                    onMoveToSection(target.id, sec.id);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                    isCurrent
                      ? 'opacity-50 cursor-default bg-theme-bg/40 font-medium'
                      : 'hover:bg-theme-bg'
                  }`}
                >
                  <span className="truncate max-w-[130px]">{sec.title}</span>
                  {isCurrent && <Check className="w-3 h-3 text-theme-accent-primary shrink-0" />}
                </button>
              );
            })}

            <div className="h-px bg-theme-border my-1" />

            {/* Inline New Section Input or Trigger */}
            {isCreatingNewSection ? (
              <form onSubmit={handleCreateSectionSubmit} className="p-1 space-y-1">
                <input
                  type="text"
                  autoFocus
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="Section name..."
                  className="w-full px-2 py-1 text-xs bg-theme-bg border border-theme-accent-primary rounded-md outline-none text-theme-text-primary placeholder:text-theme-text-muted/60"
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingNewSection(false)}
                    className="px-1.5 py-0.5 text-[10px] text-theme-text-muted hover:text-theme-text-primary cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-2 py-0.5 text-[10px] bg-theme-accent-primary text-black font-semibold rounded cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreatingNewSection(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-theme-bg text-theme-accent-primary font-medium text-left transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ New section</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. Mark as Unread */}
      <button
        onClick={() => {
          onToggleUnread(target.id);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
      >
        <Bell
          className={`w-3.5 h-3.5 transition-colors ${
            target.isUnread
              ? 'text-theme-accent-secondary fill-theme-accent-secondary/20'
              : 'text-theme-text-muted group-hover:text-theme-text-primary'
          }`}
        />
        <span>{target.isUnread ? 'Mark as Read' : 'Mark as Unread'}</span>
      </button>

      {/* Divider */}
      <div className="h-px bg-theme-border my-1 mx-1" />

      {/* 4. Edit Profile */}
      <button
        onClick={() => {
          onEditProfile(target.id);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
      >
        <Edit2 className="w-3.5 h-3.5 text-theme-text-muted group-hover:text-theme-text-primary" />
        <span>Edit Profile</span>
      </button>

      {/* 5. Duplicate */}
      <button
        onClick={() => {
          onDuplicate(target.id);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5 text-theme-text-muted group-hover:text-theme-text-primary" />
        <span>Duplicate</span>
      </button>

      {/* Divider */}
      <div className="h-px bg-theme-border my-1 mx-1" />

      {/* 6. Copy conversation ID */}
      <button
        onClick={handleCopyId}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <Copy className="w-3.5 h-3.5 text-theme-text-muted group-hover:text-theme-text-primary" />
          <span>Copy conversation ID</span>
        </div>
        {copiedNotification && (
          <span className="text-[10px] text-emerald-400 font-medium">Copied!</span>
        )}
      </button>

      {/* Divider */}
      <div className="h-px bg-theme-border my-1 mx-1" />

      {/* 7. Hide from sidebar */}
      <button
        onClick={() => {
          onHideFromSidebar(target.id);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-theme-bg transition-colors text-left group cursor-pointer"
      >
        <EyeOff className="w-3.5 h-3.5 text-theme-text-muted group-hover:text-theme-text-primary" />
        <span>Hide from sidebar</span>
      </button>

      {/* 8. Delete */}
      <button
        onClick={() => {
          onDelete(target.id);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/15 text-rose-400 transition-colors text-left group cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5 text-rose-400 group-hover:text-rose-300" />
        <span>Delete</span>
      </button>
    </div>,
    document.body
  );
};
