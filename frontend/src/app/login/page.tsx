'use client';

import React, { FormEvent, useEffect, Suspense, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { loginWithEmail, registerWithEmail } from '../../lib/api';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function LoginContent() {
  const { user, isLoading, refetchUser } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handledAuthError = useRef<string | null>(null);

  useEffect(() => {
    const authError = searchParams.get('error');
    if (!authError || handledAuthError.current === authError) return;
    handledAuthError.current = authError;

    if (authError === 'invalid_client') {
      toast.error('Google rejected the OAuth client credentials. Check that the Client ID and Client Secret belong to the same Web application client.');
    } else if (authError === 'invalid_grant') {
      toast.error('Google rejected this sign-in attempt. Please start the Google sign-in flow again.');
    } else if (authError === 'oauth_state_invalid') {
      toast.error('The secure Google sign-in session expired or was blocked. Enable cookies for localhost, then try again.');
    } else if (authError?.startsWith('google_')) {
      toast.error(`Google sign-in was cancelled or blocked (${authError.slice(7)}).`);
    } else if (authError === 'auth_failed') {
      toast.error('Google OAuth Authentication failed. Please try again.');
    }
    if (authError === 'oauth_not_configured') {
      toast.error('Google sign-in is not configured. Add valid Google OAuth credentials to the backend environment.');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  const handleGoogleSignIn = () => {
    window.location.href = `${API_BASE_URL}/api/auth/google`;
  };

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
      await refetchUser();
      router.replace('/dashboard');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Unable to authenticate. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4 sm:p-8">
      <section className="w-full max-w-[456px] rounded-[10px] border border-slate-200 bg-white px-7 py-9 sm:px-[52px] sm:py-[46px]">
        <h1 className="mb-6 text-center text-4xl font-semibold leading-tight text-[#202124]">Login</h1>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-emerald-100 bg-[#e5f6ed] text-sm font-medium text-[#202124] transition-colors hover:bg-[#d9f1e4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18A11.93 11.93 0 0 0 1 12c0 1.94.47 3.78 1.3 5.4l3.54-2.72z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          <span>Login with Google</span>
        </button>

        <div className="my-5 flex items-center gap-4 text-xs text-[#a1a4a3]">
          <span className="h-px flex-1 bg-slate-200" />
          <button
            type="button"
            onClick={() => setIsSignUp((value) => !value)}
            aria-label={isSignUp ? 'Switch to email login' : 'Switch to email sign up'}
            className="whitespace-nowrap hover:text-emerald-700 focus-visible:outline-none focus-visible:underline"
          >
            {isSignUp ? 'or log in through email' : 'or sign up through email'}
          </button>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3">
          <label className="sr-only" htmlFor="email">Email ID</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email ID"
            className="h-[52px] w-full rounded-xl border border-transparent bg-[#f3f6f4] px-[18px] text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 placeholder:text-[#687079]"
          />
          <label className="sr-only" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={8}
            maxLength={256}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="h-[52px] w-full rounded-xl border border-transparent bg-[#f3f6f4] px-[18px] text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100 placeholder:text-[#687079]"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-3 h-11 w-full rounded-xl bg-[#00aa43] text-sm font-medium text-white transition-colors hover:bg-[#00963b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {isSubmitting ? 'Please wait...' : isSignUp ? 'Create account' : 'Login'}
          </button>
        </form>

      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-xs text-slate-400 font-semibold">Loading authentication...</p>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
