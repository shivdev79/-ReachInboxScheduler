'use client';

import React from 'react';
import { Sender } from '../types';
import { Clock, Send, ShieldAlert, Cpu } from 'lucide-react';

interface StatsOverviewProps {
  scheduledCount: number;
  sentCount: number;
  senders: Sender[];
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ scheduledCount, sentCount, senders }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      
      {/* Scheduled Card */}
      <div className="glass-card p-4 rounded-xl relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Scheduled Emails</p>
            <h3 className="text-2xl font-bold text-white mt-1">{scheduledCount}</h3>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Clock className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-2 text-[11px] text-amber-300/80 font-medium">
          Queued in BullMQ Redis Engine
        </div>
      </div>

      {/* Sent Card */}
      <div className="glass-card p-4 rounded-xl relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Sent Emails</p>
            <h3 className="text-2xl font-bold text-white mt-1">{sentCount}</h3>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Send className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-2 text-[11px] text-emerald-300/80 font-medium">
          Dispatched via Ethereal SMTP
        </div>
      </div>

      {/* Multi-Sender Senders Rate-Limit Gauge Cards */}
      {senders.slice(0, 2).map((sender) => {
        const usagePct = sender.usagePercentage || 0;
        const isNearLimit = usagePct >= 80;

        return (
          <div key={sender.id} className="glass-card p-4 rounded-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="truncate pr-2">
                <p className="text-xs font-medium text-slate-400 truncate">{sender.name}</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold text-white">{sender.currentHourCount || 0}</span>
                  <span className="text-xs text-slate-400">/ {sender.hourlyLimit} hr</span>
                </div>
              </div>
              <div className={`p-2.5 rounded-lg border ${
                isNearLimit ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
              }`}>
                {isNearLimit ? <ShieldAlert className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
              </div>
            </div>

            {/* Rate limit progress bar */}
            <div className="mt-3">
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    isNearLimit ? 'bg-rose-500' : 'bg-gradient-to-r from-brand-500 to-indigo-400'
                  }`}
                  style={{ width: `${Math.min(100, usagePct)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                <span>Usage: {usagePct}%</span>
                <span>{sender.email}</span>
              </div>
            </div>
          </div>
        );
      })}

    </div>
  );
};
