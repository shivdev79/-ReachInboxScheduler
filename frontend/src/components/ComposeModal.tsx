'use client';

import React, { useState } from 'react';
import { Sender, User } from '../types';
import { scheduleEmails } from '../lib/api';
import { X, Upload, Send, Clock, Layers, FileText, CheckCircle2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  senders: Sender[];
  user: User | null;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  senders,
  user,
  onSuccess,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientsInput, setRecipientsInput] = useState('');
  const [parsedEmails, setParsedEmails] = useState<string[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState(senders[0]?.id || '');
  const [startTime, setStartTime] = useState('');
  const [delayBetweenSec, setDelayBetweenSec] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(5);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (!isOpen) return null;

  // Extract email address patterns from text or CSV rows
  const extractEmailsFromText = (text: string): string[] => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex) || [];
    return Array.from(new Set(matches.map((e) => e.toLowerCase())));
  };

  const handleManualRecipientsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setRecipientsInput(val);
    const emails = extractEmailsFromText(val);
    setParsedEmails(emails);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    Papa.parse(file, {
      complete: (results) => {
        const fullText = JSON.stringify(results.data);
        const extracted = extractEmailsFromText(fullText);
        setParsedEmails(extracted);
        setRecipientsInput(extracted.join(', '));
        toast.success(`Successfully parsed ${extracted.length} lead emails from ${file.name}`);
      },
      error: (error) => {
        toast.error(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) {
      toast.error('Email subject is required.');
      return;
    }
    if (!body.trim()) {
      toast.error('Email body is required.');
      return;
    }
    if (parsedEmails.length === 0) {
      toast.error('Please enter or upload at least 1 valid recipient email.');
      return;
    }

    setLoading(true);
    try {
      await scheduleEmails({
        subject: subject.trim(),
        body: body.trim(),
        recipients: parsedEmails,
        senderId: selectedSenderId || senders[0]?.id,
        startTime: startTime || undefined,
        delayBetweenSec,
        hourlyLimit,
        userId: user?.id,
        idempotencyKey,
      });

      toast.success(`Successfully scheduled ${parsedEmails.length} email job(s)!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to schedule emails.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div className="glass-panel w-full max-w-2xl rounded-2xl p-6 border border-slate-700/80 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white shadow-lg shadow-brand-500/20">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Compose New Email Campaign</h2>
              <p className="text-xs text-slate-400">Schedule multi-lead email sends via BullMQ delayed jobs</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          
          {/* Sender Select */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Select Sender Account
            </label>
            <select
              value={selectedSenderId}
              onChange={(e) => {
                setSelectedSenderId(e.target.value);
                const s = senders.find((s) => s.id === e.target.value);
                if (s) setHourlyLimit(s.hourlyLimit);
              }}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-indigo-500"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email}) — Limit: {s.hourlyLimit}/hr
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Subject</label>
            <input
              type="text"
              required
              placeholder="e.g. Quick question regarding cold outreach scaling"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Recipients / File Upload */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-300">
                Lead Emails (CSV Upload or Manual Paste)
              </label>
              {parsedEmails.length > 0 && (
                <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  {parsedEmails.length} Email(s) Detected
                </span>
              )}
            </div>

            {/* CSV File Drag Drop Area */}
            <div className="relative border-2 border-dashed border-slate-700 hover:border-indigo-500/60 rounded-xl p-3 text-center bg-slate-900/40 transition-colors mb-2">
              <input
                type="file"
                accept=".csv, .txt"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex items-center justify-center gap-2 text-slate-400 text-xs">
                <Upload className="h-4 w-4 text-indigo-400" />
                <span>
                  {fileName ? (
                    <span className="text-emerald-400 font-semibold">{fileName} attached</span>
                  ) : (
                    'Click or Drag & Drop Lead CSV / TXT File to Parse Addresses'
                  )}
                </span>
              </div>
            </div>

            <textarea
              rows={3}
              placeholder="Paste email addresses separated by commas or line breaks (e.g. lead1@acme.com, lead2@corp.io)"
              value={recipientsInput}
              onChange={handleManualRecipientsChange}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          {/* Email Body */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Email Content / Body</label>
            <textarea
              rows={4}
              required
              placeholder="Hi {{first_name}},&#10;&#10;I noticed your team is building scalable email pipelines..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Scheduling Parameters Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
            
            {/* Start Time */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3 text-indigo-400" />
                <span>Start Time (Optional)</span>
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Provider Delay */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <Layers className="h-3 w-3 text-indigo-400" />
                <span>Delay Between Sends (sec)</span>
              </label>
              <input
                type="number"
                min="0"
                max="60"
                value={delayBetweenSec}
                onChange={(e) => setDelayBetweenSec(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Hourly Rate Limit */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <FileText className="h-3 w-3 text-indigo-400" />
                <span>Hourly Limit (emails/hr)</span>
              </label>
              <input
                type="number"
                min="1"
                max="5000"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 5)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-indigo-500 font-semibold text-indigo-300"
              />
            </div>

          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-brand-600 to-indigo-600 text-white hover:from-brand-500 hover:to-indigo-500 transition-all shadow-lg shadow-brand-500/25 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{loading ? 'Scheduling Jobs...' : `Schedule ${parsedEmails.length || 0} Email(s)`}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
