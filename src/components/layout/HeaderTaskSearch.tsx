import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderTaskSearchProps {
  value: string;
  onChange: (text: string) => void;
}

const DEBOUNCE_MS = 250;

/**
 * Compact board search bound to searchFilters.text (same pipeline as Tools filter).
 * Local state updates immediately; parent filter updates are debounced.
 */
const HeaderTaskSearch: React.FC<HeaderTaskSearchProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef(value);

  // Sync from parent (e.g. SearchInterface / clear filters)
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const emit = (next: string) => {
    lastEmittedRef.current = next;
    onChange(next);
  };

  const scheduleEmit = (next: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => emit(next), DEBOUNCE_MS);
  };

  const handleChange = (next: string) => {
    setDraft(next);
    scheduleEmit(next);
  };

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft('');
    emit('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (draft) {
        handleClear();
      } else {
        e.currentTarget.blur();
      }
    }
  };

  return (
    <div className="relative w-full min-w-0 md:w-64">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
        aria-hidden
      />
      <input
        type="text"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('searchInterface.headerSearchPlaceholder')}
        aria-label={t('searchInterface.headerSearchPlaceholder')}
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 pl-7 pr-7 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        data-tour-id="header-task-search"
      />
      {draft ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          title={t('searchInterface.clearSearch')}
          aria-label={t('searchInterface.clearSearch')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
};

export default HeaderTaskSearch;
