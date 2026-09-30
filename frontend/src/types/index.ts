export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  slackConnected: boolean;
  slackWebhookUrl?: string;
}

export interface Sender {
  id: string;
  email: string;
  name: string;
  hourlyLimit: number;
  currentHourCount?: number;
  usagePercentage?: number;
}

export type EmailStatus = 'SCHEDULED' | 'PENDING' | 'PROCESSING' | 'SENT' | 'DELAYED_RATE_LIMIT' | 'FAILED';

export interface Email {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt?: string | null;
  delayBetweenSec: number;
  etherealPreviewUrl?: string | null;
  failureReason?: string | null;
  senderId: string;
  sender?: Sender;
  createdAt: string;
}

export interface SearchResult {
  source: string;
  emails: Email[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}
