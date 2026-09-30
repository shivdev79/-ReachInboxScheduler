import axios from 'axios';
import { prisma } from '../config/prisma';
import { claimRateLimitAlert } from './rate-limiter.service';

export async function sendSlackRateLimitAlert(params: {
  senderId: string;
  senderEmail: string;
  senderName: string;
  hourlyLimit: number;
  currentCount: number;
  hourWindow: string;
  userId?: string;
}) {
  try {
    // 1. Fetch user or global Slack Webhook configuration
    let webhookUrl: string | null = null;

    if (params.userId) {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { slackWebhookUrl: true, slackConnected: true }
      });
      if (user?.slackConnected && user?.slackWebhookUrl) {
        webhookUrl = user.slackWebhookUrl;
      }
    }

    if (!webhookUrl) {
      console.log(`ℹ️ Slack notification skipped for sender ${params.senderEmail} (Slack not connected).`);
      return false;
    }

    if (!await claimRateLimitAlert(params.senderId, params.hourWindow)) {
      console.log(`ℹ️ Slack notification deduplicated for sender ${params.senderEmail} in window ${params.hourWindow}.`);
      return false;
    }

    const payload = {
      text: `🚨 *ReachInbox Rate Limit Alert* - Sender Limit Reached!`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🚨 ReachInbox Email Hourly Rate Limit Threshold Reached!",
            emoji: true
          }
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Sender:* ${params.senderName} (<mailto:${params.senderEmail}|${params.senderEmail}>)`
            },
            {
              type: "mrkdwn",
              text: `*Hourly Limit:* \`${params.hourlyLimit} emails/hr\``
            },
            {
              type: "mrkdwn",
              text: `*Window ID:* \`${params.hourWindow}\``
            },
            {
              type: "mrkdwn",
              text: `*Action Taken:* Jobs automatically rescheduled into next hour window`
            }
          ]
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `⏰ Timestamp: *${new Date().toISOString()}* | System: *ReachInbox Scheduler Worker*`
            }
          ]
        }
      ]
    };

    const response = await axios.post(webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });
    console.log(`⚡ Slack webhook response for ${params.senderEmail}: HTTP ${response.status} ${String(response.data).trim()}`);
    return true;
  } catch (error: any) {
    console.error(`⚠️ Failed to dispatch Slack notification to webhook:`, error.message);
    return false;
  }
}
