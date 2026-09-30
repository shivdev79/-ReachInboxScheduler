import { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../config/prisma';
import { sendSlackRateLimitAlert } from '../services/slack.service';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function getSlackRedirectUri(): string {
  return process.env.SLACK_REDIRECT_URI
    || (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/slack/callback`
      : 'http://localhost:5000/api/slack/callback');
}

export function startSlackOAuth(req: Request, res: Response) {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = getSlackRedirectUri();
  if (!clientId || !process.env.SLACK_CLIENT_SECRET) {
    return res.redirect(`${FRONTEND_URL}/dashboard?error=slack_not_configured`);
  }

  const state = crypto.randomBytes(32).toString('hex');
  res.cookie('slack_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
  });
  const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', 'incoming-webhook,chat:write');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  return res.redirect(authorizeUrl.toString());
}

export async function handleSlackOAuthCallback(req: Request, res: Response) {
  try {
    const { code, state, error } = req.query;
    const savedState = req.cookies?.slack_oauth_state;
    res.clearCookie('slack_oauth_state');
    if (error || !code || typeof code !== 'string' || !state || state !== savedState) {
      return res.redirect(`${FRONTEND_URL}/dashboard?error=slack_oauth_failed`);
    }

    if (!req.user) {
      return res.redirect(`${FRONTEND_URL}/login`);
    }

    const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access', new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID || '',
      client_secret: process.env.SLACK_CLIENT_SECRET || '',
      code,
      redirect_uri: getSlackRedirectUri(),
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const oauthData = tokenResponse.data;
    const webhookUrl = oauthData.incoming_webhook?.url;
    if (!oauthData.ok || typeof webhookUrl !== 'string') {
      console.error('Slack OAuth exchange did not return an incoming webhook:', oauthData.error);
      return res.redirect(`${FRONTEND_URL}/dashboard?error=slack_oauth_failed`);
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { slackWebhookUrl: webhookUrl, slackConnected: true },
    });

    await sendSlackRateLimitAlert({
      senderId: 'slack-oauth-verification',
      senderEmail: 'notifications@reachinbox.local',
      senderName: 'ReachInbox Slack Connection Test',
      hourlyLimit: 0,
      currentCount: 0,
      hourWindow: 'CONNECTION_TEST',
      userId: req.user.id,
    });
    return res.redirect(`${FRONTEND_URL}/dashboard?slack=connected`);
  } catch (error: any) {
    console.error('Slack OAuth callback failed:', error.message);
    return res.redirect(`${FRONTEND_URL}/dashboard?error=slack_oauth_failed`);
  }
}

export async function disconnectSlack(req: Request, res: Response) {
  try {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { slackConnected: false, slackWebhookUrl: null },
    });
    return res.json({ message: 'Slack disconnected successfully', slackConnected: false });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
