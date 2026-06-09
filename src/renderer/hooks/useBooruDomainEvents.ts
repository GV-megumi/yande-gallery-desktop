import type {
  RendererBooruBlacklistTagsChangedPayload,
  RendererBooruFavoriteGroupsChangedPayload,
  RendererBooruPostDownloadStateChangedPayload,
  RendererBooruPostFavoriteChangedPayload,
  RendererBooruPostServerFavoriteChangedPayload,
  RendererBooruPostVoteChangedPayload,
  RendererBooruSavedSearchesChangedPayload,
  RendererBooruSearchHistoryChangedPayload,
  RendererBooruSitesChangedPayload,
  RendererFavoriteTagsChangedPayload,
} from '../../shared/types';
import { useRendererAppEvent } from './useRendererAppEvent';

interface UseBooruDomainEventsOptions {
  siteId: number | null;
  active?: boolean;
  onPostFavoriteChanged?: (payload: RendererBooruPostFavoriteChangedPayload) => void;
  onServerFavoriteChanged?: (payload: RendererBooruPostServerFavoriteChangedPayload) => void;
  onBlacklistTagsChanged?: (payload: RendererBooruBlacklistTagsChangedPayload) => void;
  onFavoriteTagsChanged?: (payload: RendererFavoriteTagsChangedPayload) => void;
  onSitesChanged?: (payload: RendererBooruSitesChangedPayload) => void;
  onFavoriteGroupsChanged?: (payload: RendererBooruFavoriteGroupsChangedPayload) => void;
  onSavedSearchesChanged?: (payload: RendererBooruSavedSearchesChangedPayload) => void;
  onSearchHistoryChanged?: (payload: RendererBooruSearchHistoryChangedPayload) => void;
  onPostDownloadStateChanged?: (payload: RendererBooruPostDownloadStateChangedPayload) => void;
  onPostVoteChanged?: (payload: RendererBooruPostVoteChangedPayload) => void;
}

export function useBooruDomainEvents(options: UseBooruDomainEventsOptions): void {
  const matchesSite = (eventSiteId?: number | null) => (
    options.siteId === null ||
    eventSiteId === undefined ||
    eventSiteId === null ||
    eventSiteId === options.siteId
  );

  useRendererAppEvent([
    'booru:post-favorite-changed',
    'booru:post-server-favorite-changed',
    'booru:blacklist-tags-changed',
    'booru:favorite-groups-changed',
    'booru:saved-searches-changed',
    'booru:search-history-changed',
    'booru:post-download-state-changed',
    'booru:post-vote-changed',
    'favorite-tags:changed',
    'booru:sites-changed',
  ] as const, (event) => {
    if (event.type === 'booru:post-favorite-changed' && matchesSite(event.payload.siteId)) {
      options.onPostFavoriteChanged?.(event.payload);
    }
    if (event.type === 'booru:post-server-favorite-changed' && matchesSite(event.payload.siteId)) {
      options.onServerFavoriteChanged?.(event.payload);
    }
    if (event.type === 'booru:blacklist-tags-changed' && matchesSite(event.payload.siteId)) {
      options.onBlacklistTagsChanged?.(event.payload);
    }
    if (event.type === 'booru:favorite-groups-changed' && matchesSite(event.payload.siteId)) {
      options.onFavoriteGroupsChanged?.(event.payload);
    }
    if (event.type === 'booru:saved-searches-changed' && matchesSite(event.payload.siteId)) {
      options.onSavedSearchesChanged?.(event.payload);
    }
    if (event.type === 'booru:search-history-changed' && matchesSite(event.payload.siteId)) {
      options.onSearchHistoryChanged?.(event.payload);
    }
    if (event.type === 'booru:post-download-state-changed' && matchesSite(event.payload.siteId)) {
      options.onPostDownloadStateChanged?.(event.payload);
    }
    if (event.type === 'booru:post-vote-changed' && matchesSite(event.payload.siteId)) {
      options.onPostVoteChanged?.(event.payload);
    }
    if (event.type === 'favorite-tags:changed' && matchesSite(event.payload.siteId)) {
      options.onFavoriteTagsChanged?.(event.payload);
    }
    if (event.type === 'booru:sites-changed') {
      options.onSitesChanged?.(event.payload);
    }
  }, { active: options.active });
}
