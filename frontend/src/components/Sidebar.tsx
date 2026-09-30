'use client';

import React, { useState } from 'react';
import { User, Sender } from '../types';
import { Clock, Send, Plus, ChevronDown, MessageSquare, ExternalLink, LogOut, ShieldAlert } from 'lucide-react';

interface SidebarProps {
  user: User | null;
  activeTab: 'scheduled' | 'sent';
  onSelectTab: (tab: 'scheduled' | 'sent') => void;
  scheduledCount: number;
  sentCount: number;
  onOpenCompose: () => void;
  onOpenSlackModal: () => void;
  onLogout: () => void;
  senders: Sender[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activeTab,
  onSelectTab,
  scheduledCount,
  sentCount,
  onOpenCompose,
  onOpenSlackModal,
  onLogout,
  senders,
}) => {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);

  const avatarInitials = user?.name
    ?.trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'U';

  return (
    <aside className="w-64 bg-white border-r border-slate-200 min-h-screen flex flex-col justify-between p-5 select-none">
      <div>
        
        {/* Brand Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div className="text-2xl font-black tracking-tighter text-slate-900 font-mono">
            OUTBOX
          </div>
        </div>

        {/* User Card */}
        {user && (
          <div className="relative mb-5">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label={`Account menu for ${user.name}`}
              onClick={() => setAccountMenuOpen((isOpen) => !isOpen)}
              className="w-full bg-slate-100/80 hover:bg-slate-100 p-2.5 rounded-xl flex items-center justify-between border border-slate-200/60 transition-all"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {user.avatar && failedAvatarUrl !== user.avatar ? (
                  <img
                    src={user.avatar}
                    alt=""
                    onError={() => setFailedAvatarUrl(user.avatar || null)}
                    className="w-8 h-8 rounded-full object-cover border border-slate-300 flex-shrink-0"
                  />
                ) : (
                  <span aria-hidden="true" className="w-8 h-8 rounded-full bg-emerald-700 text-white text-[10px] font-bold flex items-center justify-center border border-emerald-800/10 flex-shrink-0">
                    {avatarInitials}
                  </span>
                )}
                <span className="truncate text-left">
                  <span className="block text-xs font-bold text-slate-900 truncate leading-tight">{user.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate leading-tight">{user.email}</span>
                </span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 ml-1 transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {accountMenuOpen && (
              <div role="menu" className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Compose Button matching Figma outline style */}
        <button
          onClick={onOpenCompose}
          className="w-full py-2.5 px-4 mb-6 rounded-full border border-emerald-600 text-emerald-600 font-semibold text-xs hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Compose</span>
        </button>

        {/* Navigation CORE Section */}
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
            CORE
          </p>

          {/* Scheduled Tab */}
          <button
            onClick={() => onSelectTab('scheduled')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'scheduled'
                ? 'bg-emerald-100/70 text-emerald-900 font-bold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Clock className={`w-4 h-4 ${activeTab === 'scheduled' ? 'text-emerald-700' : 'text-slate-500'}`} />
              <span>Scheduled</span>
            </div>
            <span className={`text-[11px] ${activeTab === 'scheduled' ? 'text-emerald-800 font-bold' : 'text-slate-400'}`}>
              {scheduledCount}
            </span>
          </button>

          {/* Sent Tab */}
          <button
            onClick={() => onSelectTab('sent')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'sent'
                ? 'bg-emerald-100/70 text-emerald-900 font-bold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Send className={`w-4 h-4 ${activeTab === 'sent' ? 'text-emerald-700' : 'text-slate-500'}`} />
              <span>Sent</span>
            </div>
            <span className={`text-[11px] ${activeTab === 'sent' ? 'text-emerald-800 font-bold' : 'text-slate-400'}`}>
              {sentCount}
            </span>
          </button>
        </div>

        {/* Multi-Sender Status Widgets */}
        {senders.length > 0 && (
          <div className="mt-8 pt-4 border-t border-slate-200 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-1">
              Active Senders Rate Limit
            </p>
            {senders.slice(0, 2).map((sender) => (
              <div key={sender.id} className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px]">
                <div className="flex justify-between items-center text-slate-700 font-medium">
                  <span className="truncate max-w-[120px]">{sender.name}</span>
                  <span className="font-bold text-emerald-600">{sender.currentHourCount || 0}/{sender.hourlyLimit}</span>
                </div>
                <div className="w-full bg-slate-200 h-1 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, sender.usagePercentage || 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Footer System Integrations */}
      <div className="pt-4 border-t border-slate-200 space-y-1">
        
        {/* Slack Connect Button */}
        <button
          onClick={onOpenSlackModal}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            user?.slackConnected
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
            <span>{user?.slackConnected ? 'Slack Active' : 'Connect Slack'}</span>
          </div>
          {user?.slackConnected && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>

        {/* BullMQ Dashboard */}
        <a
          href="http://localhost:5000/admin/queues"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-all"
        >
          <span>BullMQ Dashboard</span>
          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
        </a>

      </div>

    </aside>
  );
};
