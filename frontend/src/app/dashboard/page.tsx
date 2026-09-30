'use client';

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { LogOut } from 'lucide-react';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { Sidebar } from '../../components/Sidebar';
import { EmailList } from '../../components/EmailList';
import { ComposeView } from '../../components/ComposeView';
import { EmailDetailModal } from '../../components/EmailDetailModal';
import { SlackModal } from '../../components/SlackModal';
import { getScheduledEmails, getSenders, getSentEmails, searchEmails } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Email, Sender, User } from '../../types';

function DashboardContent() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [scheduledEmails, setScheduledEmails] = useState<Email[]>([]);
  const [sentEmails, setSentEmails] = useState<Email[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [slackOpen, setSlackOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [dashboardUser, setDashboardUser] = useState<User | null>(null);

  useEffect(() => {
    if (!user) return;
    setDashboardUser({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatarUrl || undefined,
      slackConnected: user.slackConnected,
      slackWebhookUrl: user.slackWebhookUrl || undefined,
    });
  }, [user]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [scheduled, sent, senderList] = await Promise.all([
        getScheduledEmails(), getSentEmails(), getSenders(),
      ]);
      setScheduledEmails(scheduled);
      setSentEmails(sent);
      setSenders(senderList);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack') === 'connected') {
      toast.success('Slack connected. Rate-limit alerts will be sent to the selected channel.');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error') === 'slack_not_configured') {
      toast.error('Slack OAuth is not configured on the backend.');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error') === 'slack_oauth_failed') {
      toast.error('Slack authorization failed. Please try connecting again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleSearch = async (query: string) => {
    if (!query.trim()) return refresh();
    try {
      setLoading(true);
      const result = await searchEmails(
        query,
        activeTab === 'scheduled'
          ? 'SCHEDULED,PENDING,DELAYED_RATE_LIMIT,PROCESSING'
          : 'SENT,FAILED',
      );
      if (activeTab === 'scheduled') setScheduledEmails(result.emails);
      else setSentEmails(result.emails);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const visibleEmails = activeTab === 'scheduled' ? scheduledEmails : sentEmails;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar user={dashboardUser} activeTab={activeTab} onSelectTab={setActiveTab}
        scheduledCount={scheduledEmails.length} sentCount={sentEmails.length}
        onOpenCompose={() => setComposeOpen(true)} onOpenSlackModal={() => setSlackOpen(true)}
        onLogout={() => { void logout(); }} senders={senders} />
      <main className="min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{activeTab === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}</h1>
            <p className="mt-1 text-xs text-slate-500">Manage your email queue and delivery history.</p>
          </div>
          <button
            type="button"
            onClick={() => { void logout(); }}
            className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
        <EmailList emails={visibleEmails} type={activeTab} loading={loading}
          onRefresh={() => { void refresh(); }} onSearch={(query) => { void handleSearch(query); }}
          onSelectEmail={setSelectedEmail} />
      </main>
      {composeOpen && <ComposeView onClose={() => setComposeOpen(false)} senders={senders} user={dashboardUser} onSuccess={() => { void refresh(); }} />}
      <EmailDetailModal email={selectedEmail} onClose={() => setSelectedEmail(null)} />
      <SlackModal isOpen={slackOpen} onClose={() => setSlackOpen(false)} user={dashboardUser} onUpdateUser={setDashboardUser} />
    </div>
  );
}

export default function DashboardPage() {
  return <ProtectedRoute><DashboardContent /></ProtectedRoute>;
}
