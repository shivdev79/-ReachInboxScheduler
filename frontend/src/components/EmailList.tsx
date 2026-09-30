'use client';

import React, { useState } from 'react';
import { Email } from '../types';
import { Search, Filter, RotateCw, Clock, Star, ExternalLink, Mail } from 'lucide-react';

interface EmailListProps {
  emails: Email[];
  type: 'scheduled' | 'sent';
  loading: boolean;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onSelectEmail: (email: Email) => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  type,
  loading,
  onRefresh,
  onSearch,
  onSelectEmail,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  const formatScheduledBadge = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    return `${day} ${time}`;
  };

  return (
    <div className="flex-1 bg-white min-h-screen p-6">
      
      {/* Top Search & Controls Bar */}
      <div className="flex items-center gap-3 mb-6">
        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              onSearch(e.target.value);
            }}
            className="w-full bg-slate-100/70 text-slate-800 text-xs rounded-full pl-10 pr-4 py-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/30 transition-all placeholder-slate-400"
          />
        </form>

        <button
          onClick={onRefresh}
          className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-all"
          title="Filter"
        >
          <Filter className="w-4 h-4" />
        </button>

        <button
          onClick={onRefresh}
          className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-all"
          title="Refresh"
        >
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
        </button>
      </div>

      {/* Email List Content */}
      {loading ? (
        <div className="py-20 text-center text-slate-400 text-xs font-medium">
          Loading emails from queue engine...
        </div>
      ) : emails.length === 0 ? (
        <div className="py-20 text-center">
          <Mail className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-600">No {type} emails found</p>
          <p className="text-[11px] text-slate-400 mt-1">Use the "Compose" button to schedule email jobs</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {emails.map((email) => (
            <div
              key={email.id}
              onClick={() => onSelectEmail(email)}
              className="py-3.5 px-3 flex items-center justify-between hover:bg-slate-50 rounded-xl cursor-pointer transition-all group"
            >
              
              {/* Left Column: To: Recipient */}
              <div className="w-48 flex-shrink-0 text-xs font-bold text-slate-900 truncate">
                To: {email.recipient}
              </div>

              {/* Middle Column: Badge + Subject & Body Snippet */}
              <div className="flex-1 flex items-center gap-3 px-4 min-w-0">
                
                {/* Badge matching Figma screenshots */}
                {type === 'scheduled' ? (
                  <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100/90 text-amber-900 border border-amber-200/60">
                    <Clock className="w-3.5 h-3.5 text-amber-700" />
                    <span>{formatScheduledBadge(email.scheduledAt)}</span>
                  </span>
                ) : email.status === 'FAILED' ? (
                  <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                    Failed
                  </span>
                ) : (
                  <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-200/80 text-slate-700">
                    Sent
                  </span>
                )}

                {/* Subject & snippet */}
                <div className="truncate text-xs">
                  <span className="font-bold text-slate-900">{email.subject}</span>
                  <span className="text-slate-400 ml-1.5 font-normal truncate">
                    - {email.body}
                  </span>
                </div>
              </div>

              {/* Right Column: Ethereal Link + Star Icon */}
              <div className="flex items-center gap-3 flex-shrink-0 pl-2">
                {email.etherealPreviewUrl && (
                  <a
                    href={email.etherealPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                  >
                    <span>Ethereal</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <Star className="w-4 h-4 text-slate-300 hover:text-amber-400 transition-colors" />
              </div>

            </div>
          ))}
        </div>
      )}

    </div>
  );
};
