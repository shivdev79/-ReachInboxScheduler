import axios from 'axios';
import { Email, Sender, SearchResult, User } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function loginGoogleUser(data: {
  credential?: string;
  email?: string;
  name?: string;
  avatar?: string;
  googleId?: string;
}) {
  const res = await api.post('/api/auth/google', data);
  return res.data;
}

export async function loginWithEmail(email: string, password: string) {
  const res = await api.post('/api/auth/email/login', { email, password });
  return res.data;
}

export async function registerWithEmail(email: string, password: string) {
  const res = await api.post('/api/auth/email/register', { email, password });
  return res.data;
}

export async function getSenders(): Promise<Sender[]> {
  const res = await api.get('/api/senders');
  return res.data.senders;
}

export async function getScheduledEmails(): Promise<Email[]> {
  const res = await api.get('/api/emails/scheduled');
  return res.data.emails;
}

export async function getSentEmails(): Promise<Email[]> {
  const res = await api.get('/api/emails/sent');
  return res.data.sent || res.data.emails;
}

export async function searchEmails(query: string, status: string = 'ALL'): Promise<SearchResult> {
  const res = await api.get(`/api/emails/search?q=${encodeURIComponent(query)}&status=${status}`);
  return res.data;
}

export async function scheduleEmails(payload: {
  subject: string;
  body: string;
  recipients: string[];
  senderId: string;
  startTime?: string;
  delayBetweenSec?: number;
  hourlyLimit?: number;
  userId?: string;
  idempotencyKey: string;
}) {
  const { idempotencyKey, ...body } = payload;
  const res = await api.post('/api/emails/schedule', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return res.data;
}

export function connectSlack() {
  window.location.assign(`${API_BASE_URL}/api/slack/oauth`);
}

export async function disconnectSlack() {
  const res = await api.post('/api/slack/disconnect');
  return res.data;
}

export default api;
