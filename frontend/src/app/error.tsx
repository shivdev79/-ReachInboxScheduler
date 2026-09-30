'use client';

import React, { useEffect } from 'react';
import { Mail, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Error caught by error boundary:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-rose-100 border border-rose-200 flex items-center justify-center mb-4 text-rose-600 shadow-sm">
        <Mail className="w-8 h-8" />
      </div>
      <h1 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h1>
      <p className="text-xs text-slate-500 mb-6 max-w-sm">
        {error.message || 'An unexpected error occurred during rendering.'}
      </p>
      <button
        onClick={() => reset()}
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Try Again</span>
      </button>
    </div>
  );
}
