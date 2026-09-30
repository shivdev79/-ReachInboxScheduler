import { Request, Response } from 'express';
import crypto from 'crypto';
import { promisify } from 'util';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../config/prisma';
import { getJwtSecret } from '../config/auth';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(':');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(keyHex, 'hex');
  const suppliedKey = await scryptAsync(password, salt, expectedKey.length) as Buffer;
  return expectedKey.length === suppliedKey.length && crypto.timingSafeEqual(expectedKey, suppliedKey);
}

function setAuthCookie(res: Response, userId: string) {
  const jwtToken = jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
  res.cookie('auth_token', jwtToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function isGoogleOAuthConfigured(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
  const isPlaceholder = (value: string) =>
    /your_google_client|your-google-client|placeholder|demo/i.test(value);

  return (
    clientId.endsWith('.apps.googleusercontent.com') &&
    !isPlaceholder(clientId) &&
    clientSecret.length > 0 &&
    !isPlaceholder(clientSecret)
  );
}

function getGoogleOAuthClient(): OAuth2Client {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI
    || (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/auth/google/callback`
      : 'http://localhost:5000/api/auth/google/callback');

  return new OAuth2Client(
    googleClientId,
    googleClientSecret,
    googleRedirectUri
  );
}

export async function redirectToGoogleConsent(req: Request, res: Response) {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    const googleClientId = process.env.GOOGLE_CLIENT_ID || '';

    // Store state parameter in short-lived httpOnly cookie for CSRF validation
    res.cookie('oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000,
    });

    if (!isGoogleOAuthConfigured()) {
      console.error('Google OAuth is not configured with a valid client ID and client secret.');
      res.clearCookie('oauth_state');
      return res.redirect(`${FRONTEND_URL}/login?error=oauth_not_configured`);
    }

    // Direct to Real Google OAuth Consent URL
    const client = getGoogleOAuthClient();
    const consentUrl = client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    });

    console.log('🔑 Redirecting to Google OAuth consent.');
    return res.redirect(consentUrl);
  } catch (error: any) {
    console.error('❌ Error generating Google consent URL:', error);
    return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
  }
}

export async function handleGoogleCallback(req: Request, res: Response) {
  const { code, state, error: googleError } = req.query;
  const savedState = req.cookies?.oauth_state;

  if (googleError) {
    res.clearCookie('oauth_state');
    return res.redirect(`${FRONTEND_URL}/login?error=google_${encodeURIComponent(String(googleError))}`);
  }

  // CSRF Check: Validate state parameter against httpOnly cookie
  if (!state || !savedState || state !== savedState) {
    console.warn('⚠️ Google OAuth CSRF State Mismatch rejected.');
    res.clearCookie('oauth_state');
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_state_invalid`);
  }

  res.clearCookie('oauth_state');

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_code_missing`);
  }

  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
    const client = getGoogleOAuthClient();

    // Exchange authorization code for tokens
    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      console.error('❌ Missing id_token in Google OAuth response');
      return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
    }

    // Verify id_token server-side with Google OAuth Client ID audience
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email || !payload.email_verified) {
      console.error('❌ Invalid Google ID Token payload');
      return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
    }

    const profile = {
      email: payload.email,
      name: payload.name || 'Google User',
      avatarUrl: payload.picture || null,
    };
    const existingUser = await prisma.user.findUnique({ where: { googleId: payload.sub } })
      || await prisma.user.findUnique({ where: { email: payload.email } });
    const user = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: { ...profile, googleId: payload.sub },
        })
      : await prisma.user.create({
          data: { ...profile, googleId: payload.sub },
        });

    // Sign 7-day JWT containing userId payload
    setAuthCookie(res, user.id);

    console.log(`✅ Google OAuth 2.0 Auth Code Flow Success for: ${user.email} (${user.id})`);
    return res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (error: any) {
    console.error('❌ Google OAuth Callback Error:', error.message);
    const providerError = error.response?.data?.error;
    const safeError = providerError === 'invalid_client' || providerError === 'invalid_grant'
      ? providerError
      : 'auth_failed';
    return res.redirect(`${FRONTEND_URL}/login?error=${safeError}`);
  }
}

export async function registerWithEmail(req: Request, res: Response) {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 256) {
    return res.status(400).json({ error: 'Enter a valid email and a password between 8 and 256 characters.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    }

    const user = await prisma.user.create({
      data: {
        email,
        name: email.split('@')[0],
        passwordHash: await hashPassword(password),
      },
    });
    setAuthCookie(res, user.id);
    return res.status(201).json({ id: user.id, email: user.email, name: user.name });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    }
    console.error('Email registration failed:', error.message);
    return res.status(500).json({ error: 'Unable to create account right now.' });
  }
}

export async function loginWithEmail(req: Request, res: Response) {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    const validPassword = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : false;
    if (!user || !validPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    setAuthCookie(res, user.id);
    return res.json({ id: user.id, email: user.email, name: user.name });
  } catch (error: any) {
    console.error('Email sign-in failed:', error.message);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
}

export async function getCurrentUserSession(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const slackSettings = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { slackConnected: true },
  });
  return res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    avatarUrl: req.user.avatarUrl,
    slackConnected: slackSettings?.slackConnected ?? false,
  });
}

export async function handleLogoutSession(req: Request, res: Response) {
  res.clearCookie('auth_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res.status(204).send();
}
