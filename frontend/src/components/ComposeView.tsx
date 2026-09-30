'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Sender, User } from '../types';
import { scheduleEmails } from '../lib/api';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  Upload,
  Calendar as CalendarIcon,
  RotateCcw,
  RotateCw,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  AlignLeft,
  IndentDecrease,
  IndentIncrease,
  Strikethrough,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

interface ComposeViewProps {
  onClose: () => void;
  senders: Sender[];
  user: User | null;
  onSuccess: () => void;
}

export const ComposeView: React.FC<ComposeViewProps> = ({
  onClose,
  senders,
  user,
  onSuccess,
}) => {
  const [selectedSenderId, setSelectedSenderId] = useState(senders[0]?.id || '');
  const [recipientsInput, setRecipientsInput] = useState('');
  const [parsedEmails, setParsedEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delayBetweenSec, setDelayBetweenSec] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(5);
  const [startTime, setStartTime] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelection = useRef<Range | null>(null);
  const [formatState, setFormatState] = useState({ bold: false, italic: false, underline: false });
  
  const [showSendLaterPopup, setShowSendLaterPopup] = useState(false);
  const [insertDialog, setInsertDialog] = useState<'link' | 'image' | null>(null);
  const [insertUrl, setInsertUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const syncFormatState = () => {
    const selection = window.getSelection();
    if (!selection?.anchorNode || !editorRef.current?.contains(selection.anchorNode)) return;
    setFormatState({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    });
  };

  useEffect(() => {
    document.addEventListener('selectionchange', syncFormatState);
    return () => document.removeEventListener('selectionchange', syncFormatState);
  }, []);

  const saveEditorSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      savedSelection.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreEditorSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    if (!savedSelection.current) return;

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedSelection.current);
  };

  const applyEditorCommand = (command: string, value?: string) => {
    restoreEditorSelection();
    document.execCommand(command, false, value);
    if (editorRef.current) setBody(editorRef.current.innerHTML);
    saveEditorSelection();
    syncFormatState();
  };

  const applyEditorStyle = (tag: string) => {
    applyEditorCommand('formatBlock', tag);
  };

  const openInsertDialog = (type: 'link' | 'image') => {
    saveEditorSelection();
    setInsertUrl('');
    setInsertDialog(type);
  };

  const insertFromDialog = (event: React.FormEvent) => {
    event.preventDefault();
    const value = insertUrl.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      toast.error('Enter a valid URL.');
      return;
    }

    const allowedProtocols = insertDialog === 'link' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      toast.error('Use a valid web URL for this item.');
      return;
    }

    restoreEditorSelection();
    if (insertDialog === 'image') {
      document.execCommand('insertImage', false, parsedUrl.href);
    } else {
      const selection = window.getSelection();
      if (selection?.toString()) {
        document.execCommand('createLink', false, parsedUrl.href);
      } else {
        const escapedUrl = parsedUrl.href.replace(/[&<>"']/g, (character) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[character]!);
        document.execCommand('insertHTML', false, `<a href="${escapedUrl}">${escapedUrl}</a>`);
      }
    }
    if (editorRef.current) setBody(editorRef.current.innerHTML);
    saveEditorSelection();
    setInsertDialog(null);
  };

  const extractEmailsFromText = (text: string): string[] => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex) || [];
    return Array.from(new Set(matches.map((e) => e.toLowerCase())));
  };

  const addRecipients = (text: string) => {
    const emails = extractEmailsFromText(text);
    if (emails.length > 0) {
      setParsedEmails((current) => Array.from(new Set([...current, ...emails])));
    }
  };

  const handleManualRecipientsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/[\s,;]+/.test(value)) {
      const parts = value.split(/[\s,;]+/);
      const complete = parts.slice(0, -1).join(' ');
      addRecipients(complete);
      setRecipientsInput(parts[parts.length - 1] || '');
      return;
    }
    setRecipientsInput(value);
  };

  const commitRecipientDraft = () => {
    addRecipients(recipientsInput);
    setRecipientsInput('');
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
        toast.success(`Parsed ${extracted.length} lead emails from ${file.name}`);
      },
      error: (error) => {
        toast.error(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const recipients = Array.from(new Set([...parsedEmails, ...extractEmailsFromText(recipientsInput)]));
    if (!subject.trim()) {
      toast.error('Subject is required.');
      return;
    }
    const bodyText = editorRef.current?.innerText.trim() || '';
    if (!bodyText) {
      toast.error('Body is required.');
      return;
    }
    if (recipients.length === 0) {
      toast.error('Please enter at least 1 recipient email address.');
      return;
    }

    setLoading(true);
    try {
      await scheduleEmails({
        subject: subject.trim(),
        body: body.trim(),
        recipients,
        senderId: selectedSenderId || senders[0]?.id,
        startTime: startTime || undefined,
        delayBetweenSec,
        hourlyLimit,
        userId: user?.id,
        idempotencyKey,
      });

      toast.success(`Successfully scheduled ${recipients.length} email job(s)!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to schedule emails.');
    } finally {
      setLoading(false);
    }
  };

  const selectedSender = senders.find((s) => s.id === selectedSenderId) || senders[0];

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col animate-fadeIn overflow-y-auto">
      
      {/* Top Header matching Screenshot 5 */}
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            title="Back to inbox"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-sm font-semibold text-slate-800">Compose New Email</h1>
        </div>

        <div className="relative flex items-center gap-1.5">
          
          {/* CSV File Upload Paperclip */}
          <label title="Upload recipient list" className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-emerald-700">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Paperclip className="h-3.5 w-3.5" />
          </label>

          {/* Clock Icon for Send Later Popup */}
          <button
            type="button"
            onClick={() => setShowSendLaterPopup(!showSendLaterPopup)}
            className={`rounded-md p-1.5 transition-colors ${
              showSendLaterPopup || startTime ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
            title="Send Later"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>

          {/* Outline Green Send Button matching Figma */}
          <button
            type="button"
            onClick={() => {
              if (!startTime) {
                setShowSendLaterPopup(true);
                return;
              }
              void handleSubmit();
            }}
            disabled={loading}
            className="rounded-full border border-emerald-600 px-3 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          >
            {loading ? 'Scheduling...' : 'Send Later'}
          </button>

          {/* Send Later Popup Window matching Screenshot 5 */}
          {showSendLaterPopup && (
            <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xl">
              <h3 className="font-bold text-slate-900 mb-3">Send Later</h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Pick date & time</label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 text-xs outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5 pt-1 text-slate-600">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(Date.now() + 86400000);
                      d.setHours(9, 0, 0, 0);
                      setStartTime(d.toISOString().slice(0, 16));
                    }}
                    className="w-full text-left py-1 hover:text-emerald-600"
                  >
                    Tomorrow, 9:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(Date.now() + 86400000);
                      d.setHours(10, 0, 0, 0);
                      setStartTime(d.toISOString().slice(0, 16));
                    }}
                    className="w-full text-left py-1 hover:text-emerald-600"
                  >
                    Tomorrow, 10:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(Date.now() + 86400000);
                      d.setHours(15, 0, 0, 0);
                      setStartTime(d.toISOString().slice(0, 16));
                    }}
                    className="w-full text-left py-1 hover:text-emerald-600"
                  >
                    Tomorrow, 3:00 PM
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowSendLaterPopup(false)}
                    className="px-3 py-1 text-slate-400 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSendLaterPopup(false)}
                    className="px-4 py-1.5 rounded-full border border-emerald-600 text-emerald-600 font-semibold hover:bg-emerald-50"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Form Fields matching Screenshot 5 */}
      <form onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }} className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-4 pb-5 pt-3 sm:px-6">
        <div className="space-y-1.5">
        
        {/* From Dropdown */}
        <div className="flex min-h-8 items-center gap-3 border-b border-slate-100 py-1">
          <span className="w-12 flex-shrink-0 text-[11px] font-medium text-slate-500">From</span>
          <div className="relative min-w-0">
            <select
              value={selectedSenderId}
              onChange={(e) => {
                setSelectedSenderId(e.target.value);
                const s = senders.find((s) => s.id === e.target.value);
                if (s) setHourlyLimit(s.hourlyLimit);
              }}
              className="max-w-full appearance-none rounded-md border border-transparent bg-slate-100 py-1 pl-2.5 pr-7 text-[11px] font-medium text-slate-700 outline-none transition hover:bg-slate-200 focus:border-emerald-400"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* To Lead Input */}
        <div className="flex min-h-9 items-start gap-3 border-b border-slate-100 py-1.5">
          <span className="w-12 flex-shrink-0 pt-1 text-[11px] font-medium text-slate-500">To</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {parsedEmails.map((recipient) => (
              <span key={recipient} className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] leading-4 text-emerald-900">
                <span className="max-w-[180px] truncate">{recipient}</span>
                <button type="button" aria-label={`Remove ${recipient}`} onClick={() => setParsedEmails((emails) => emails.filter((email) => email !== recipient))} className="rounded-full text-emerald-700 hover:text-rose-600">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder={parsedEmails.length ? 'Add recipient' : 'Enter email address'}
              value={recipientsInput}
              onChange={handleManualRecipientsChange}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  commitRecipientDraft();
                }
                if (event.key === 'Backspace' && !recipientsInput && parsedEmails.length) {
                  setParsedEmails((emails) => emails.slice(0, -1));
                }
              }}
              onBlur={commitRecipientDraft}
              className="min-w-[120px] flex-1 border-0 bg-transparent py-1 text-[11px] text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
          <label className="flex flex-shrink-0 cursor-pointer items-center gap-1 pt-1 text-[10px] font-medium text-emerald-700 hover:text-emerald-800">
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="sr-only" />
            <Upload className="h-3 w-3" />
            <span>Upload List</span>
            {fileName && <span className="hidden max-w-24 truncate text-slate-400 sm:inline">{fileName}</span>}
          </label>
        </div>

        {/* Subject */}
        <div className="flex min-h-8 items-center gap-3 border-b border-slate-100 py-1">
          <label className="w-12 flex-shrink-0 text-[11px] font-medium text-slate-500" htmlFor="compose-subject">Subject</label>
          <input
            id="compose-subject"
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[11px] text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>

        {/* Delay and hourly limit controls */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2">
          <label className="flex items-center gap-2 text-[10px] text-slate-600">
            <span>Delay between emails</span>
            <input
              type="number"
              min="0"
              max="3600"
              value={delayBetweenSec}
              onChange={(e) => setDelayBetweenSec(parseInt(e.target.value, 10) || 0)}
              className="h-6 w-10 rounded border border-slate-200 bg-white text-center text-[10px] text-slate-700 outline-none focus:border-emerald-500"
            />
            <span>sec</span>
          </label>
          <label className="flex items-center gap-2 text-[10px] text-slate-600">
            <span>Hourly Limit</span>
            <input
              type="number"
              min="1"
              max="5000"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 1)}
              className="h-6 w-10 rounded border border-slate-200 bg-white text-center text-[10px] text-slate-700 outline-none focus:border-emerald-500"
            />
          </label>
          {parsedEmails.length > 0 && <span className="text-[10px] text-slate-400">{parsedEmails.length} recipients</span>}
        </div>

        {/* Editor Area */}
        <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border border-slate-100 bg-[#fafafa] sm:min-h-[300px]">
          <div className="px-3 pt-2 text-[10px] text-slate-400">Type Your Reply...</div>
          <div className="mx-2 mt-1 flex min-h-8 items-center gap-2 overflow-x-auto rounded-md bg-white px-2 text-slate-500">
            <button type="button" title="Undo" aria-label="Undo" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('undo')} className="shrink-0 hover:text-slate-800"><RotateCcw className="h-3 w-3" /></button>
            <button type="button" title="Redo" aria-label="Redo" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('redo')} className="shrink-0 hover:text-slate-800"><RotateCw className="h-3 w-3" /></button>
            <span className="h-3 border-l border-slate-200" />
            <select aria-label="Text style" title="Text style" defaultValue="p" onMouseDown={saveEditorSelection} onChange={(event) => applyEditorStyle(event.target.value)} className="h-6 shrink-0 rounded bg-transparent text-[10px] text-slate-600 outline-none hover:text-slate-900">
              <option value="p">Tt Paragraph</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
            <span className="h-3 border-l border-slate-200" />
            <button type="button" title="Bold" aria-label="Bold" aria-pressed={formatState.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('bold')} className={`shrink-0 rounded px-1.5 py-1 transition-colors ${formatState.bold ? 'bg-emerald-100 text-emerald-800' : 'hover:text-slate-800'}`}><Bold className="h-3 w-3" /></button>
            <button type="button" title="Italic" aria-label="Italic" aria-pressed={formatState.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('italic')} className={`shrink-0 rounded px-1.5 py-1 transition-colors ${formatState.italic ? 'bg-emerald-100 text-emerald-800' : 'hover:text-slate-800'}`}><Italic className="h-3 w-3" /></button>
            <button type="button" title="Underline" aria-label="Underline" aria-pressed={formatState.underline} onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('underline')} className={`shrink-0 rounded px-1.5 py-1 transition-colors ${formatState.underline ? 'bg-emerald-100 text-emerald-800' : 'hover:text-slate-800'}`}><Underline className="h-3 w-3" /></button>
            <span className="h-3 border-l border-slate-200" />
            <select aria-label="Text alignment" title="Text alignment" defaultValue="justifyLeft" onMouseDown={saveEditorSelection} onChange={(event) => applyEditorCommand(event.target.value)} className="h-6 w-8 shrink-0 rounded bg-transparent text-[10px] text-slate-600 outline-none hover:text-slate-900">
              <option value="justifyLeft">Left</option>
              <option value="justifyCenter">Center</option>
              <option value="justifyRight">Right</option>
              <option value="justifyFull">Justify</option>
            </select>
            <button type="button" title="Bulleted list" aria-label="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('insertUnorderedList')} className="shrink-0 hover:text-slate-800"><List className="h-3 w-3" /></button>
            <button type="button" title="Numbered list" aria-label="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('insertOrderedList')} className="shrink-0 hover:text-slate-800"><ListOrdered className="h-3 w-3" /></button>
            <button type="button" title="Decrease indent" aria-label="Decrease indent" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('outdent')} className="shrink-0 hover:text-slate-800"><IndentDecrease className="h-3 w-3" /></button>
            <button type="button" title="Increase indent" aria-label="Increase indent" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('indent')} className="shrink-0 hover:text-slate-800"><IndentIncrease className="h-3 w-3" /></button>
            <span className="h-3 border-l border-slate-200" />
            <button type="button" title="Quote" aria-label="Quote" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorStyle('blockquote')} className="shrink-0 hover:text-slate-800"><Quote className="h-3 w-3" /></button>
            <button type="button" title="Code block" aria-label="Code block" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorStyle('pre')} className="shrink-0 hover:text-slate-800"><Code className="h-3 w-3" /></button>
            <button type="button" title="Insert link" aria-label="Insert link" onMouseDown={(event) => event.preventDefault()} onClick={() => openInsertDialog('link')} className="shrink-0 hover:text-slate-800"><LinkIcon className="h-3 w-3" /></button>
            <button type="button" title="Insert image" aria-label="Insert image" onMouseDown={(event) => event.preventDefault()} onClick={() => openInsertDialog('image')} className="shrink-0 hover:text-slate-800"><ImageIcon className="h-3 w-3" /></button>
            <button type="button" title="Strikethrough" aria-label="Strikethrough" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('strikeThrough')} className="shrink-0 hover:text-slate-800"><Strikethrough className="h-3 w-3" /></button>
            <button type="button" title="Align left" aria-label="Align left" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand('justifyLeft')} className="shrink-0 hover:text-slate-800"><AlignLeft className="h-3 w-3" /></button>
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            aria-label="Email body"
            role="textbox"
            aria-multiline="true"
            data-placeholder="Type your message..."
            onInput={(event) => setBody(event.currentTarget.innerHTML)}
            onKeyUp={() => { saveEditorSelection(); syncFormatState(); }}
            onMouseUp={() => { saveEditorSelection(); syncFormatState(); }}
            className="compose-editor w-full flex-1 overflow-y-auto bg-transparent p-3 text-xs leading-relaxed text-slate-800 outline-none"
          />
        </div>
        </div>
        <button type="submit" disabled={loading} className="sr-only">Schedule email</button>
      </form>

      {insertDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setInsertDialog(null);
        }}>
          <form role="dialog" aria-modal="true" aria-labelledby="insert-url-title" onSubmit={insertFromDialog} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="insert-url-title" className="text-sm font-semibold text-slate-900">
              {insertDialog === 'link' ? 'Insert link' : 'Insert image'}
            </h2>
            <label htmlFor="compose-insert-url" className="mt-4 block text-xs font-medium text-slate-600">URL</label>
            <input
              id="compose-insert-url"
              type="url"
              autoFocus
              required
              value={insertUrl}
              onChange={(event) => setInsertUrl(event.target.value)}
              placeholder={insertDialog === 'link' ? 'https://example.com' : 'https://example.com/image.png'}
              className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setInsertDialog(null)} className="rounded-md px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="submit" className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">Insert</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
