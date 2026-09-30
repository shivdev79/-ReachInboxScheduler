'use client';

import React from 'react';
import { Email } from '../types';
import { ExternalLink, Clock, AlertTriangle, CheckCircle, Mail, Loader2 } from 'lucide-react';

interface EmailTableProps {
  emails: Email[];
  type: 'scheduled' | 'sent';
  loading: boolean;
}

export const EmailTable: React.FC<EmailTableProps> = ({ emails, type, loading }) => {
  if (loading) {
    return (
      <div className="glass-panel p-12 rounded-2xl text-center border border-slate-800">
        <Loader2 className="h-8 w-8 text-indigo-400 animate-spin mx-auto mb-3" />
        <p className="text-xs text-slate-400 font-medium">Loading emails from backend scheduler...</p>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="glass-panel p-12 rounded-2xl text-center border border-slate-800">
        <Mail className="h-10 w-10 text-slate-600 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-slate-300">
          No {type === 'scheduled' ? 'Scheduled' : 'Sent'} Emails Found
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          {type === 'scheduled'
            ? 'Click "Compose New Email" to schedule campaign jobs via BullMQ queue.'
            : 'Emails will appear here once dispatched via Ethereal SMTP.'}
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-5 py-3.5">Recipient Lead</th>
              <th className="px-5 py-3.5">Subject</th>
              <th className="px-5 py-3.5">Sender</th>
              <th className="px-5 py-3.5">{type === 'scheduled' ? 'Scheduled Time' : 'Sent Time'}</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5 text-right">Actions / SMTP Link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
            {emails.map((email) => {
              const scheduledDate = new Date(email.scheduledAt).toLocaleString();
              const sentDate = email.sentAt ? new Date(email.sentAt).toLocaleString() : 'Pending';

              return (
                <tr key={email.id} className="hover:bg-slate-800/40 transition-colors">
                  
                  {/* Recipient */}
                  <td className="px-5 py-4 font-mono font-semibold text-white">
                    {email.recipient}
                  </td>

                  {/* Subject */}
                  <td className="px-5 py-4 max-w-xs truncate">
                    <p className="text-white font-medium truncate">{email.subject}</p>
                    <p className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">{email.body}</p>
                  </td>

                  {/* Sender */}
                  <td className="px-5 py-4 text-slate-300">
                    <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] border border-slate-700 font-mono">
                      {email.sender?.email || 'System Sender'}
                    </span>
                  </td>

                  {/* Time */}
                  <td className="px-5 py-4 whitespace-nowrap text-slate-400 text-[11px]">
                    {type === 'scheduled' ? scheduledDate : sentDate}
                  </td>

                  {/* Status */}
                  <td className="px-5 py-4 whitespace-nowrap">
                    {email.status === 'SENT' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle className="h-3 w-3" /> SENT
                      </span>
                    )}

                    {email.status === 'SCHEDULED' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                        <Clock className="h-3 w-3" /> SCHEDULED
                      </span>
                    )}

                    {email.status === 'PROCESSING' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 animate-pulse">
                        <Loader2 className="h-3 w-3 animate-spin" /> PROCESSING
                      </span>
                    )}

                    {email.status === 'DELAYED_RATE_LIMIT' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                        <AlertTriangle className="h-3 w-3 text-rose-400" /> DELAYED (RATE LIMIT)
                      </span>
                    )}

                    {email.status === 'FAILED' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/30">
                        <AlertTriangle className="h-3 w-3" /> FAILED
                      </span>
                    )}
                  </td>

                  {/* Action Link to Ethereal */}
                  <td className="px-5 py-4 text-right whitespace-nowrap">
                    {email.etherealPreviewUrl ? (
                      <a
                        href={email.etherealPreviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
                      >
                        <span>View Ethereal Email</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-slate-600 text-[11px]">In Queue</span>
                    )}
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
