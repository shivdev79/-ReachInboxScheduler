'use client';

import React, { useState } from 'react';
import { User } from '../types';
import { connectSlack, disconnectSlack } from '../lib/api';
import { X, MessageSquare, CheckCircle, Send } from 'lucide-react';
import toast from 'react-hot-toast';

interface SlackModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onUpdateUser: (updated: User) => void;
}

export const SlackModal: React.FC<SlackModalProps> = ({ isOpen, onClose, user, onUpdateUser }) => {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleConnect = () => {
    setLoading(true);
    connectSlack();
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectSlack();
      toast.success('Slack disconnected');
      if (user) {
        onUpdateUser({ ...user, slackConnected: false });
      }
      onClose();
    } catch (err: any) {
      toast.error('Failed to disconnect Slack');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="glass-panel w-full max-w-lg rounded-2xl p-6 border border-slate-700/80 shadow-2xl relative">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Slack Alert Integration</h2>
            <p className="text-xs text-slate-400">Receive live notifications when hourly rate limits are hit</p>
          </div>
        </div>

        {user?.slackConnected ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-emerald-300 text-sm font-medium">
              <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-emerald-200">Slack Webhook Connected & Operational</p>
                <p className="text-xs text-emerald-400/80">Rate-limit alerts will be sent to the connected Slack channel.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 transition-all"
              >
                {loading ? 'Disconnecting...' : 'Disconnect Slack'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-white border border-slate-700 hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-300">Authorize ReachInbox in Slack. The selected channel webhook will be stored for your account and used for live rate-limit alerts.</p>
            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConnect}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{loading ? 'Redirecting to Slack...' : 'Connect Slack'}</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
