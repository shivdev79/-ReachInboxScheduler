'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 border border-rose-200 flex items-center justify-center mb-4 text-rose-600 shadow-sm">
          ⚠️
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Application Error</h1>
        <p className="text-xs text-slate-500 mb-6 max-w-sm">
          {error.message || 'A global error occurred.'}
        </p>
        <button
          onClick={() => reset()}
          className="px-6 py-2.5 rounded-full bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20"
        >
          Reset Application
        </button>
      </body>
    </html>
  );
}
