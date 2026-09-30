'use client';

import React from 'react';
import { Email } from '../types';
import { ArrowLeft, Star, Trash2, ExternalLink, Paperclip } from 'lucide-react';

interface EmailDetailModalProps {
  email: Email | null;
  onClose: () => void;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ email, onClose }) => {
  if (!email) return null;

  const eventTime = email.sentAt || email.scheduledAt;
  const formattedTime = new Date(eventTime).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const senderName = email.sender?.name || 'Unknown sender';
  const senderEmail = email.sender?.email || 'No sender email';
  const senderInitial = senderName.charAt(0).toUpperCase() || 'A';
  const queueSummary = `Scheduled via BullMQ delayed queue engine with minimum ${email.delayBetweenSec || 2}s provider throttling delay.`;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col animate-fadeIn overflow-y-auto">
      
      {/* Header matching Screenshot 4 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-slate-900 truncate max-w-xl">
            {email.subject}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button className="p-1.5 text-slate-400 hover:text-amber-500">
            <Star className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-slate-400 hover:text-rose-500">
            <Trash2 className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center border border-slate-300">
            {senderInitial}
          </div>
        </div>
      </div>

      {/* Main Email Content Area */}
      <div className="max-w-4xl w-full mx-auto p-8 space-y-6">
        
        {/* Sender Info Row */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-md">
              {senderInitial}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {senderName}{' '}
                <span className="text-slate-400 font-normal text-xs">&lt;{senderEmail}&gt;</span>
              </p>
              <p className="text-xs text-slate-400">to {email.recipient || 'recipient'} ▾</p>
            </div>
          </div>

          <span className="text-xs text-slate-400 font-medium">{formattedTime}</span>
        </div>

        {/* Ethereal Email Link Banner if available */}
        {email.etherealPreviewUrl ? (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs text-emerald-800 font-medium">
            <span>Dispatched via Ethereal SMTP Test Server</span>
            <a
              href={email.etherealPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-emerald-700 font-bold hover:underline"
            >
              <span>View Rendered Ethereal Email</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : email.status === 'SENT' ? (
          <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 font-medium">
            Email sent successfully via Ethereal SMTP. Preview URL is not currently available from the test inbox.
          </div>
        ) : null}

        {/* Email Body Text */}
        <div className="text-sm text-slate-800 leading-relaxed space-y-4 whitespace-pre-wrap font-sans pt-2">
          {email.body}
        </div>

        {/* Queue information derived from the actual email row */}
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
          <p className="font-bold">⚡ Queue status</p>
          <p className="text-amber-800">{queueSummary}</p>
        </div>

      </div>

    </div>
  );
};
