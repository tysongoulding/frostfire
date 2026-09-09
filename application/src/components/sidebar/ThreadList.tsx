import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { SidebarSection, SidebarItem } from '../../types';
import {
  Bot,
  Users,
  MessageSquare,
  Cloud,
  Shield,
  Network,
  Stethoscope,
  GraduationCap,
  Star,
  ChevronDown,
  ChevronRight,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  Flame,
  Snowflake,
} from 'lucide-react';
import { ContextMenu, ContextMenuPosition, ContextMenuItemTarget, SectionOption } from './ContextMenu';

interface ThreadListProps {
  sections: SidebarSection[];
  items: Record<string, SidebarItem>;
  selectedItemId: string;
  onSelectItem: (id: string) => void;
  onToggleCollapseSection: (sectionId: string) => void;
  onReorderSections: (draggedSectionId: string, targetSectionId: string) => void;
  onMoveItemToSection: (itemId: string, targetSectionId: string) => void;
  onAddSection: (title: string, id?: string) => void;
  onRenameSection?: (sectionId: string, newTitle: string) => void;
  onDeleteSection?: (sectionId: string) => void;
  onTogglePinItem: (id: string) => void;
  onToggleUnreadItem: (id: string) => void;
  onEditProfileItem: (id: string) => void;
  onDuplicateItem: (id: string) => void;
  onCopyConversationId: (id: string) => void;
  onHideFromSidebar: (id: string) => void;
  onDeleteItem: (id: string) => void;
  isWorking?: boolean;
}

export const ThreadList: React.FC<ThreadListProps> = ({
  sections,
  items,
  selectedItemId,
  onSelectItem,
  onToggleCollapseSection,
  onReorderSections,
  onMoveItemToSection,
  onAddSection,
  onRenameSection,
  onDeleteSection,
  onTogglePinItem,
  onToggleUnreadItem,
  onEditProfileItem,
  onDuplicateItem,
  onCopyConversationId,
  onHideFromSidebar,
  onDeleteItem,
  isWorking = false,
}) => {
  const { theme } = useTheme();
  const isFireTheme = theme === 'fire';
  const dotColor = isFireTheme ? 'bg-[#FF3366]' : 'bg-[#38BDF8]';

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    position: ContextMenuPosition;
    target: ContextMenuItemTarget | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    target: null,
  });

  // Section 3-dot menu and rename state
  const [openSectionMenuId, setOpenSectionMenuId] = useState<string | null>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renameSectionTitle, setRenameSectionTitle] = useState('');
  const sectionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSectionMenuId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sectionMenuRef.current && !sectionMenuRef.current.contains(e.target as Node)) {
        setOpenSectionMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openSectionMenuId]);

  // Drag & drop state
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  // New section inline input
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');

  const handleContextMenu = (e: React.MouseEvent, item: SidebarItem) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenuState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      target: {
        id: item.id,
        title: item.title,
        isPinned: item.isPinned,
        isStarred: item.isStarred ?? item.isPinned,
        isUnread: item.isUnread,
        isTeam: item.isTeam,
        sectionId: item.sectionId,
      },
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenuState((prev) => ({ ...prev, isOpen: false, target: null }));
  };

  const handleCreateSectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionTitle.trim()) return;
    onAddSection(newSectionTitle.trim());
    setNewSectionTitle('');
    setIsAddingSection(false);
  };

  const getItemAvatar = (item: SidebarItem) => {
    if (item.isTeam) {
      return (
        <div className="relative w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
          <Users className="w-4 h-4" />
          {item.memberCount !== undefined && (
            <span className="absolute -bottom-1 -right-1 px-1 py-0.2 bg-theme-bg text-[9px] font-bold rounded-full border border-theme-border text-emerald-400">
              +{item.memberCount}
            </span>
          )}
        </div>
      );
    }

    if (item.id === 'netaws') {
      return (
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
          <Cloud className="w-4 h-4" />
        </div>
      );
    }

    if (item.id === 'netsentry') {
      return (
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
          <Shield className="w-4 h-4" />
        </div>
      );
    }

    if (item.id === 'netops') {
      return (
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
          <Network className="w-4 h-4" />
        </div>
      );
    }

    if (item.id === 'netdoctor') {
      return (
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
          <Stethoscope className="w-4 h-4" />
        </div>
      );
    }

    if (item.id === 'nettrainer') {
      return (
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
          <GraduationCap className="w-4 h-4" />
        </div>
      );
    }

    if (item.id === 'pretender') {
      return (
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
          <MessageSquare className="w-4 h-4" />
        </div>
      );
    }

    return (
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${item.accentClass}`}>
        <Bot className="w-4 h-4" />
      </div>
    );
  };

  // Section options for context menu (exclude Star section)
  const sectionOptions: SectionOption[] = sections
    .filter((s) => !s.isStarSection && !s.isPinnedSection)
    .map((s) => ({ id: s.id, title: s.title }));

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 space-y-2 select-none">
      {sections.map((section) => {
        // Collect items belonging to this section
        const isStarSec = Boolean(section.isStarSection || section.isPinnedSection);
        const isUnassignedSec = Boolean(section.isUnassignedSection || section.isDefaultSection);
        const isFixedSec = isStarSec || isUnassignedSec;
        const hasStarSec = sections.some((s) => s.isStarSection || s.isPinnedSection);

        const sectionItems = Object.values(items).filter((item) => {
          if (item.isHidden) return false;
          if (isStarSec) {
            return Boolean(item.isStarred ?? item.isPinned);
          }
          if (hasStarSec && (item.isStarred || item.isPinned)) return false;
          if (item.sectionId === section.id) return true;
          if (isUnassignedSec) {
            return !item.sectionId || item.sectionId === 'unassigned' || item.sectionId === 'default';
          }
          return false;
        });

        // Hide Star section only if empty and not being dragged over
        if (isStarSec && sectionItems.length === 0 && dragOverSectionId !== section.id) {
          return null;
        }

        const isOver = dragOverSectionId === section.id;

        return (
          <div
            key={section.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverSectionId !== section.id) {
                setDragOverSectionId(section.id);
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              if (dragOverSectionId === section.id) {
                setDragOverSectionId(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverSectionId(null);

              const droppedItemId = e.dataTransfer.getData('application/frostfire-item');
              const droppedSecId = e.dataTransfer.getData('application/frostfire-section');

              if (droppedItemId) {
                onMoveItemToSection(droppedItemId, section.id);
              } else if (droppedSecId && droppedSecId !== section.id && !isFixedSec) {
                onReorderSections(droppedSecId, section.id);
              }
            }}
            className={`rounded-xl transition-all duration-200 ${
              isOver
                ? 'ring-1 ring-theme-accent-primary bg-theme-accent-primary/5 p-1'
                : 'p-0.5'
            }`}
          >
            {/* Section Header */}
            <div
              draggable={!isFixedSec && renamingSectionId !== section.id}
              onDragStart={(e) => {
                if (isFixedSec || renamingSectionId === section.id) return;
                e.dataTransfer.setData('application/frostfire-section', section.id);
                setDraggedSectionId(section.id);
              }}
              onDragEnd={() => {
                setDraggedSectionId(null);
                setDragOverSectionId(null);
              }}
              className={`relative flex items-center justify-between px-2 py-1 rounded-lg text-[11px] font-semibold text-theme-text-muted hover:text-theme-text-primary group ${
                !isFixedSec ? 'cursor-grab active:cursor-grabbing' : ''
              } ${draggedSectionId === section.id ? 'opacity-40' : ''}`}
            >
              <div
                onClick={() => {
                  if (renamingSectionId !== section.id) {
                    onToggleCollapseSection(section.id);
                  }
                }}
                className="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0 mr-1"
              >
                {/* Section Expand/Collapse Chevron Icon */}
                {section.isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-theme-text-muted shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-theme-text-muted shrink-0" />
                )}

                {renamingSectionId === section.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameSectionTitle.trim()) {
                        onRenameSection?.(section.id, renameSectionTitle.trim());
                      }
                      setRenamingSectionId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={renameSectionTitle}
                      onChange={(e) => setRenameSectionTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setRenamingSectionId(null);
                      }}
                      onBlur={() => {
                        if (renameSectionTitle.trim()) {
                          onRenameSection?.(section.id, renameSectionTitle.trim());
                        }
                        setRenamingSectionId(null);
                      }}
                      className="w-full bg-theme-bg border border-theme-accent-primary text-theme-text-primary text-[10px] px-1.5 py-0.5 rounded outline-none font-medium uppercase tracking-tight"
                    />
                  </form>
                ) : (
                  <>
                    <span className="truncate tracking-tight font-medium uppercase text-[10px]">
                      {section.title}
                    </span>

                    <span className="text-[10px] text-theme-text-muted/60 font-mono">
                      ({sectionItems.length})
                    </span>
                  </>
                )}
              </div>

              {/* Action buttons on section header */}
              <div className="flex items-center gap-1 shrink-0">
                {/* 3-dot menu button for renamable & deletable sections */}
                {!isFixedSec && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSectionMenuId(openSectionMenuId === section.id ? null : section.id);
                      }}
                      className="p-1 rounded hover:bg-theme-bg text-theme-text-muted hover:text-theme-text-primary transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                      title="Section options"
                    >
                      <MoreVertical className="w-3 h-3" />
                    </button>

                    {openSectionMenuId === section.id && (
                      <div
                        ref={sectionMenuRef}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-full mt-1 z-50 min-w-[125px] bg-theme-surface/98 border border-theme-border rounded-xl shadow-xl p-1 text-xs text-theme-text-primary backdrop-blur-md animate-in fade-in zoom-in-95 select-none"
                      >
                        <button
                          onClick={() => {
                            setRenamingSectionId(section.id);
                            setRenameSectionTitle(section.title);
                            setOpenSectionMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-theme-bg text-left transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-theme-text-muted" />
                          <span>Rename</span>
                        </button>
                        <button
                          onClick={() => {
                            onDeleteSection?.(section.id);
                            setOpenSectionMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/15 text-rose-400 text-left transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Action for Unassigned section header: quick add section button */}
                {isUnassignedSec && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddingSection(!isAddingSection);
                    }}
                    className="p-1 rounded hover:bg-theme-bg text-theme-text-muted hover:text-theme-text-primary transition-colors cursor-pointer"
                    title="Add new section"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Items inside this section (if not collapsed) */}
            {!section.isCollapsed && (
              <div className="space-y-0.5 mt-0.5">
                {sectionItems.length === 0 && isOver ? (
                  <div className="py-3 text-center text-[11px] text-theme-accent-primary border border-dashed border-theme-accent-primary/40 rounded-xl bg-theme-accent-primary/5">
                    Drop to add to {section.title}
                  </div>
                ) : (
                  sectionItems.map((item) => {
                    const isSelected = selectedItemId === item.id;
                    const isDraggingThis = draggedItemId === item.id;
                    const isItemWorking = isSelected && isWorking;

                    return (
                      <div
                        key={item.id}
                        draggable={true}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('application/frostfire-item', item.id);
                          setDraggedItemId(item.id);
                        }}
                        onDragEnd={() => {
                          setDraggedItemId(null);
                          setDragOverSectionId(null);
                        }}
                        onClick={() => onSelectItem(item.id)}
                        onContextMenu={(e) => handleContextMenu(e, item)}
                        className={`w-full text-left p-2 rounded-xl flex items-start gap-2.5 transition-all cursor-pointer group relative ${
                          isSelected
                            ? 'bg-theme-bg border border-theme-border shadow-xs'
                            : 'hover:bg-theme-bg/60 border border-transparent'
                        } ${isDraggingThis ? 'opacity-40 scale-98' : ''}`}
                      >
                        {/* Avatar */}
                        <div className="relative shrink-0">
                          {getItemAvatar(item)}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center min-w-0">
                              <span className="font-semibold text-xs text-theme-text-primary truncate">
                                {item.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {isSelected && (
                                isWorking ? (
                                  <div className="icon-morph-container w-3.5 h-3.5 mr-0.5" title="Actively working">
                                    <Flame className="icon-flame w-3.5 h-3.5" />
                                    <Snowflake className="icon-snowflake w-3.5 h-3.5" />
                                  </div>
                                ) : (
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${dotColor} theme-status-dot mr-0.5 shrink-0`}
                                    title="Ready"
                                  />
                                )
                              )}
                              {(item.isStarred ?? item.isPinned) && (
                                <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                              )}
                              {item.isUnread && (
                                <span className="w-2 h-2 rounded-full bg-theme-accent-secondary" />
                              )}
                              <span className="text-[10px] text-theme-text-muted font-mono">
                                {item.timestamp}
                              </span>
                            </div>
                          </div>

                          {(() => {
                            const hasRole = Boolean(item.roleTag && !item.roleTag.toLowerCase().includes('display'));
                            let subtitle = hasRole ? item.roleTag : item.preview;
                            if (subtitle && subtitle.toLowerCase().includes('display')) {
                              subtitle = '';
                            }
                            return subtitle ? (
                              <p className="text-[11px] text-theme-text-muted truncate mt-0.5">
                                {subtitle}
                              </p>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* New Section Inline Creator */}
      {isAddingSection && (
        <form
          onSubmit={handleCreateSectionSubmit}
          className="p-2.5 bg-theme-bg border border-theme-accent-primary/60 rounded-xl space-y-2 animate-in fade-in"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-theme-text-primary">
            <span>Create New Section</span>
          </div>
          <input
            type="text"
            autoFocus
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            placeholder="Section name (e.g. Operations, Escalations)..."
            className="w-full px-2.5 py-1.5 text-xs bg-theme-surface border border-theme-border rounded-lg outline-none text-theme-text-primary focus:border-theme-accent-primary"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setIsAddingSection(false)}
              className="px-2.5 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 text-xs bg-theme-accent-primary text-black font-semibold rounded-md shadow-xs active:scale-95 cursor-pointer"
            >
              Add Section
            </button>
          </div>
        </form>
      )}

      {/* Context Menu Modal */}
      <ContextMenu
        isOpen={contextMenuState.isOpen}
        position={contextMenuState.position}
        target={contextMenuState.target}
        sections={sectionOptions}
        onClose={handleCloseContextMenu}
        onTogglePin={onTogglePinItem}
        onMoveToSection={onMoveItemToSection}
        onCreateAndMoveToSection={(itemId, newSecTitle) => {
          const newId = `section-${Date.now()}`;
          onAddSection(newSecTitle, newId);
          onMoveItemToSection(itemId, newId);
        }}
        onToggleUnread={onToggleUnreadItem}
        onEditProfile={onEditProfileItem}
        onDuplicate={onDuplicateItem}
        onCopyConversationId={onCopyConversationId}
        onHideFromSidebar={onHideFromSidebar}
        onDelete={onDeleteItem}
      />
    </div>
  );
};
