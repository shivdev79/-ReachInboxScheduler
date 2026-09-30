'use client';

import React, { useState } from 'react';
import { AuthUser } from '../context/AuthContext';
import { LogOut } from 'lucide-react';

interface HeaderProps {
  user: AuthUser;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, onLogout }) => {
  const [imgError, setImgError] = useState(false);

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shadow-sm">
      
      {/* Brand Logo */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-black font-mono tracking-tighter text-slate-900">
          OUTBOX
        </span>
      </div>

      {/* User Info Header & Logout */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          
          {/* Avatar with fallback initials */}
          {user.avatarUrl && !imgError ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              onError={() => setImgError(true)}
              className="w-9 h-9 rounded-full object-cover border border-slate-300 shadow-sm"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-sm">
              {getInitials(user.name)}
            </div>
          )}

          <div className="text-left">
            <p className="text-xs font-bold text-slate-900 leading-tight">{user.name}</p>
            <p className="text-[11px] text-slate-500 leading-tight">{user.email}</p>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </button>
      </div>

    </header>
  );
};
