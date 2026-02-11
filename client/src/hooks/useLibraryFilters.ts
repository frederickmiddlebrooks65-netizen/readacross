import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'wouter';
import { matchesSource } from '@/lib/source/classifier';
import { type UISource } from '@/lib/source/types';

export type SortOption = 'recent' | 'uploaded' | 'name' | 'progress';
export type StatusFilter = 'active' | 'archived' | 'all';
export type SourceFilter = UISource; // Use UISource type from SSOT
export type CategoryFilter = 'News' | 'Literature' | 'Academic' | 'Opinion' | 'Other';

export interface LibraryFilters {
  sort: SortOption;
  status: StatusFilter;
  sources: SourceFilter[];
  categories: CategoryFilter[];
  search: string;
}

const DEFAULT_FILTERS: LibraryFilters = {
  sort: 'recent',
  status: 'active',
  sources: ['uploaded', 'saved', 'rss'],
  categories: [],
  search: ''
};

export function useLibraryFilters() {
  const [location, setLocation] = useLocation();
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [isInitialized, setIsInitialized] = useState(false);

  // Parse URL on mount
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    const urlFilters: LibraryFilters = {
      sort: (searchParams.get('sort') as SortOption) || DEFAULT_FILTERS.sort,
      status: (searchParams.get('status') as StatusFilter) || DEFAULT_FILTERS.status,
      sources: searchParams.get('sources')?.split(',').filter(Boolean) as SourceFilter[] || DEFAULT_FILTERS.sources,
      categories: searchParams.get('categories')?.split(',').filter(Boolean) as CategoryFilter[] || DEFAULT_FILTERS.categories,
      search: searchParams.get('search') || DEFAULT_FILTERS.search
    };

    setFilters(urlFilters);
    setIsInitialized(true);
  }, []);

  // Sync to URL when filters change (with debounce)
  useEffect(() => {
    if (!isInitialized) return;

    // Use shorter debounce for non-search filters, longer for search
    const debounceTime = filters.search !== DEFAULT_FILTERS.search ? 300 : 100;

    const timeoutId = setTimeout(() => {
      const searchParams = new URLSearchParams();

      if (filters.sort !== DEFAULT_FILTERS.sort) {
        searchParams.set('sort', filters.sort);
      }
      if (filters.status !== DEFAULT_FILTERS.status) {
        searchParams.set('status', filters.status);
      }
      if (filters.sources.length > 0 && JSON.stringify(filters.sources.sort()) !== JSON.stringify(DEFAULT_FILTERS.sources.sort())) {
        searchParams.set('sources', filters.sources.join(','));
      }
      if (filters.categories.length > 0) {
        searchParams.set('categories', filters.categories.join(','));
      }
      if (filters.search) {
        searchParams.set('search', filters.search);
      }

      const newSearch = searchParams.toString();
      const currentPath = window.location.pathname;
      const newUrl = newSearch ? `${currentPath}?${newSearch}` : currentPath;

      if (window.location.pathname + window.location.search !== newUrl) {
        window.history.replaceState(null, '', newUrl);
      }
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [filters, isInitialized]);

  // Calculate badge count (items different from default)
  const badgeCount = useMemo(() => {
    let count = 0;

    // Status filter changed
    if (filters.status !== DEFAULT_FILTERS.status) count++;

    // Sources filter changed (check both length and content)
    const currentSources = [...filters.sources].sort();
    const defaultSources = [...DEFAULT_FILTERS.sources].sort();
    if (currentSources.length !== defaultSources.length || 
        !currentSources.every((source, index) => source === defaultSources[index])) {
      count++;
    }

    // Categories filter applied (any selection counts as filter)
    if (filters.categories.length > 0) count++;

    return count;
  }, [filters]);

  // Calculate filter chips with type and value for i18n support
  const filterChips = useMemo(() => {
    const chips: Array<{ key: string; type: 'status' | 'sources' | 'category'; value: string | string[]; onRemove: () => void }> = [];

    if (filters.status !== DEFAULT_FILTERS.status) {
      chips.push({
        key: 'status',
        type: 'status',
        value: filters.status,
        onRemove: () => updateFilters({ status: DEFAULT_FILTERS.status })
      });
    }

    if (JSON.stringify(filters.sources.sort()) !== JSON.stringify(DEFAULT_FILTERS.sources.sort())) {
      chips.push({
        key: 'sources',
        type: 'sources',
        value: filters.sources,
        onRemove: () => updateFilters({ sources: DEFAULT_FILTERS.sources })
      });
    }

    filters.categories.forEach((category) => {
      chips.push({
        key: `category-${category}`,
        type: 'category',
        value: category,
        onRemove: () => updateFilters({ 
          categories: filters.categories.filter(c => c !== category) 
        })
      });
    });

    return chips;
  }, [filters]);

  const updateFilters = (updates: Partial<LibraryFilters>) => {
    setFilters(prev => ({ ...prev, ...updates }));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const clearAllFilters = () => {
    resetFilters();
  };

  return {
    filters,
    updateFilters,
    resetFilters,
    clearAllFilters,
    badgeCount,
    filterChips,
    isInitialized
  };
}