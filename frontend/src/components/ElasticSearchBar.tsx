'use client';

import React, { useState } from 'react';
import { Search, Database, Sparkles, X } from 'lucide-react';

interface ElasticSearchBarProps {
  onSearch: (query: string) => void;
  onClear: () => void;
  activeSource?: string;
}

export const ElasticSearchBar: React.FC<ElasticSearchBarProps> = ({ onSearch, onClear, activeSource }) => {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleClear = () => {
    setQuery('');
    onClear();
  };

  return (
    <div className="mb-6">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <div className="absolute left-4 text-indigo-400">
          <Search className="h-4 w-4" />
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value === '') onClear();
          }}
          placeholder="Search scheduled & sent emails via Elasticsearch (query by lead email, subject, or content)..."
          className="w-full pl-11 pr-28 py-3 rounded-xl bg-slate-900/90 border border-slate-700/80 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-xl transition-all"
        />

        <div className="absolute right-3 flex items-center gap-2">
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Elastic Search</span>
          </button>
        </div>
      </form>

      {activeSource && (
        <div className="flex items-center gap-2 mt-2 px-1 text-[11px] text-indigo-300">
          <Database className="h-3 w-3 text-indigo-400" />
          <span>Index Provider: <strong>{activeSource}</strong></span>
        </div>
      )}
    </div>
  );
};
