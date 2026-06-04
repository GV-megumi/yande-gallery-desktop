import type {
  BooruSite,
  BooruSiteRecord,
  FavoriteTag,
  ListQueryParams,
  UpsertFavoriteTagDownloadBindingInput,
} from '../../../shared/types.js';
import {
  addFavoriteTag,
  addToFavorites,
  getActiveBooruSite,
  getBooruPostBySiteAndId,
  getBooruSites,
  getDownloadQueueForDisplay,
  getFavoriteTagDownloadBinding,
  getFavoriteTagsWithDownloadState,
  getFavorites,
  deleteFavoriteTagDownloadBinding,
  removeFavoriteTag,
  removeFromFavorites,
  searchBooruPosts,
  setPostLiked,
  startFavoriteTagBulkDownload,
  updateFavoriteTag,
  upsertFavoriteTagDownloadBinding,
} from '../../services/booruService.js';
import {
  cancelBulkDownloadSession,
  getActiveBulkDownloadSessions,
  getBulkDownloadTaskById,
  getBulkDownloadTasks,
  pauseBulkDownloadSession,
  startBulkDownloadSession,
} from '../../services/bulkDownloadService.js';
import { numberParam, optionalNumberQuery, readJsonBody } from '../router.js';
import { ApiHttpError, type ApiRequestContext, type ApiRoute } from '../types.js';

const MAX_LIMIT = 200;
const VALID_SORT_KEYS = new Set(['tagName', 'galleryName', 'lastDownloadedAt']);
const VALID_SORT_ORDERS = new Set(['asc', 'desc']);
const VALID_QUERY_TYPES = new Set(['tag', 'raw', 'list']);
const FAVORITE_TAG_PATCH_KEYS = new Set([
  'tagName',
  'labels',
  'queryType',
  'notes',
  'sortOrder',
  'siteId',
]);
const FAVORITE_TAG_CREATE_KEYS = new Set([
  'tagName',
  'siteId',
  'labels',
  'queryType',
  'notes',
]);
const FAVORITE_CREATE_KEYS = new Set(['notes']);
const BINDING_INPUT_KEYS = new Set([
  'favoriteTagId',
  'downloadPath',
  'galleryId',
  'enabled',
  'autoCreateGallery',
  'autoSyncGalleryAfterDownload',
  'quality',
  'perPage',
  'concurrency',
  'skipIfExists',
  'notifications',
  'blacklistedTags',
]);

type JsonObject = Record<string, unknown>;
type ServiceControlResult = { success: boolean; queued?: boolean; error?: string };
type FavoriteTagUpdate = Partial<Pick<
  FavoriteTag,
  'tagName' | 'labels' | 'queryType' | 'sortOrder' | 'siteId'
>> & { notes?: string | null };

function notFound(): never {
  throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
}

function validationError(message: string): never {
  throw new ApiHttpError(422, 'VALIDATION_ERROR', message);
}

async function callService<T>(
  operation: () => Promise<T>,
  fallbackMessage = 'Service request failed',
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiHttpError) {
      throw error;
    }

    throw new ApiHttpError(500, 'INTERNAL_ERROR', fallbackMessage);
  }
}

function toSafeBooruSite(site: BooruSiteRecord | null): BooruSite | null {
  if (!site) {
    return null;
  }

  const safeSite: BooruSite = {
    id: site.id,
    name: site.name,
    url: site.url,
    type: site.type,
    favoriteSupport: Boolean(site.favoriteSupport),
    active: Boolean(site.active),
    authenticated: Boolean(site.username && site.passwordHash),
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
  if (site.version !== undefined) {
    safeSite.version = site.version;
  }
  if (site.username !== undefined) {
    safeSite.username = site.username;
  }

  return safeSite;
}

function toSafeBooruSites(sites: BooruSiteRecord[]): BooruSite[] {
  return sites.map((site) => toSafeBooruSite(site)!);
}

async function jsonObject(context: ApiRequestContext): Promise<JsonObject> {
  const body = await readJsonBody(context.req);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    validationError('Request body must be an object');
  }

  return body as JsonObject;
}

function requiredLimitQuery(context: ApiRequestContext, defaultValue: number): number {
  const limit = optionalNumberQuery(context.query, 'limit', defaultValue);
  if (limit > MAX_LIMIT) {
    validationError(`limit must be <= ${MAX_LIMIT}`);
  }

  return limit;
}

function requiredPageQuery(context: ApiRequestContext, defaultValue: number): number {
  return optionalNumberQuery(context.query, 'page', defaultValue);
}

function nonNegativeIntegerQuery(context: ApiRequestContext, name: string, defaultValue: number): number {
  const value = context.query.get(name);
  if (value == null || value === '') {
    return defaultValue;
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    validationError(`Invalid numeric query: ${name}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    validationError(`Invalid numeric query: ${name}`);
  }

  return parsed;
}

function requiredNumberQuery(context: ApiRequestContext, name: string): number {
  return numberParam(context.query.get(name), name);
}

function optionalNullableNumberQuery(context: ApiRequestContext, name: string): number | null | undefined {
  const value = context.query.get(name);
  if (value == null || value === '') {
    return undefined;
  }

  if (value === 'null') {
    return null;
  }

  return numberParam(value, name);
}

function nullableNumberBody(value: unknown, name: string, defaultValue: number | null): number | null {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    validationError(`Invalid numeric field: ${name}`);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    validationError(`${name} must be a string array`);
  }

  return value;
}

function optionalNullableString(value: unknown, name: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string') {
    return value;
  }

  validationError(`${name} must be a string or null`);
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    validationError(`${name} must be a boolean`);
  }

  return value;
}

function optionalNullableBoolean(value: unknown, name: string): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }

  validationError(`${name} must be a boolean or null`);
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    validationError(`${name} must be a positive integer`);
  }

  return value;
}

function optionalNullablePositiveInteger(value: unknown, name: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return optionalPositiveInteger(value, name);
}

function assertKnownKeys(body: JsonObject, allowedKeys: Set<string>): void {
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      validationError(`Unknown field: ${key}`);
    }
  }
}

function tagsFromPost(tags: string): string[] {
  return tags.split(/\s+/).map((tag) => tag.trim()).filter(Boolean);
}

async function getPostOrThrow(siteId: number, postId: number) {
  const post = await callService(
    () => getBooruPostBySiteAndId(siteId, postId),
    'Failed to load booru post',
  );
  if (!post) {
    notFound();
  }

  return post;
}

function favoriteTagListQuery(context: ApiRequestContext): ListQueryParams {
  const params: ListQueryParams = {
    limit: requiredLimitQuery(context, 50),
    offset: nonNegativeIntegerQuery(context, 'offset', 0),
  };
  const siteId = optionalNullableNumberQuery(context, 'siteId');
  const keyword = context.query.get('keyword')?.trim();
  const sortKey = context.query.get('sortKey');
  const sortOrder = context.query.get('sortOrder');

  if (siteId !== undefined) {
    params.siteId = siteId;
  }
  if (keyword) {
    params.keyword = keyword;
  }
  if (sortKey && VALID_SORT_KEYS.has(sortKey)) {
    params.sortKey = sortKey as ListQueryParams['sortKey'];
  } else if (sortKey) {
    validationError('Invalid sortKey');
  }
  if (sortOrder && VALID_SORT_ORDERS.has(sortOrder)) {
    params.sortOrder = sortOrder as ListQueryParams['sortOrder'];
  } else if (sortOrder) {
    validationError('Invalid sortOrder');
  }

  return params;
}

function favoriteTagOptions(body: JsonObject): Parameters<typeof addFavoriteTag>[2] {
  assertKnownKeys(body, FAVORITE_TAG_CREATE_KEYS);

  const options: Parameters<typeof addFavoriteTag>[2] = {};
  const labels = optionalStringArray(body.labels, 'labels');
  const notes = optionalNullableString(body.notes, 'notes');

  if (labels) {
    options.labels = labels;
  }
  if (body.queryType !== undefined) {
    const queryType = optionalString(body.queryType);
    if (!queryType || !VALID_QUERY_TYPES.has(queryType)) {
      validationError('Invalid queryType');
    }
    options.queryType = queryType as FavoriteTag['queryType'];
  }
  if (typeof notes === 'string') {
    options.notes = notes;
  }

  return options;
}

function favoriteCreateNotes(body: JsonObject): string | undefined {
  assertKnownKeys(body, FAVORITE_CREATE_KEYS);

  const notes = optionalNullableString(body.notes, 'notes');
  return typeof notes === 'string' ? notes : undefined;
}

async function assertFavoriteTagExists(id: number): Promise<void> {
  const result = await callService(
    () => getFavoriteTagsWithDownloadState({ limit: 0 }),
    'Failed to load favorite tags',
  );
  if (!result.items.some((item) => item.id === id)) {
    notFound();
  }
}

function favoriteTagPatchInput(body: JsonObject): FavoriteTagUpdate {
  assertKnownKeys(body, FAVORITE_TAG_PATCH_KEYS);

  const updates: FavoriteTagUpdate = {};
  if (body.tagName !== undefined) {
    const tagName = optionalString(body.tagName)?.trim();
    if (!tagName) {
      validationError('tagName is required');
    }
    updates.tagName = tagName;
  }
  if (body.labels !== undefined) {
    updates.labels = optionalStringArray(body.labels, 'labels');
  }
  if (body.queryType !== undefined) {
    const queryType = optionalString(body.queryType);
    if (!queryType || !VALID_QUERY_TYPES.has(queryType)) {
      validationError('Invalid queryType');
    }
    updates.queryType = queryType as FavoriteTag['queryType'];
  }
  if (body.notes !== undefined) {
    updates.notes = optionalNullableString(body.notes, 'notes');
  }
  if (body.sortOrder !== undefined) {
    updates.sortOrder = optionalPositiveInteger(body.sortOrder, 'sortOrder');
  }
  if (body.siteId !== undefined) {
    updates.siteId = optionalNullablePositiveInteger(body.siteId, 'siteId') ?? null;
  }
  if (Object.keys(updates).length === 0) {
    validationError('No valid updates provided');
  }

  return updates;
}

function bindingInput(id: number, body: JsonObject): UpsertFavoriteTagDownloadBindingInput {
  assertKnownKeys(body, BINDING_INPUT_KEYS);

  const downloadPath = optionalString(body.downloadPath)?.trim();
  if (!downloadPath) {
    validationError('downloadPath is required');
  }

  const input: UpsertFavoriteTagDownloadBindingInput = {
    favoriteTagId: id,
    downloadPath,
  };
  if (body.favoriteTagId !== undefined) {
    optionalPositiveInteger(body.favoriteTagId, 'favoriteTagId');
  }

  const galleryId = optionalNullablePositiveInteger(body.galleryId, 'galleryId');
  const enabled = optionalBoolean(body.enabled, 'enabled');
  const autoCreateGallery = optionalNullableBoolean(body.autoCreateGallery, 'autoCreateGallery');
  const autoSyncGalleryAfterDownload = optionalNullableBoolean(
    body.autoSyncGalleryAfterDownload,
    'autoSyncGalleryAfterDownload',
  );
  const quality = optionalNullableString(body.quality, 'quality');
  const perPage = optionalNullablePositiveInteger(body.perPage, 'perPage');
  const concurrency = optionalNullablePositiveInteger(body.concurrency, 'concurrency');
  const skipIfExists = optionalNullableBoolean(body.skipIfExists, 'skipIfExists');
  const notifications = optionalNullableBoolean(body.notifications, 'notifications');
  const blacklistedTags = body.blacklistedTags === null
    ? null
    : optionalStringArray(body.blacklistedTags, 'blacklistedTags');

  if (galleryId !== undefined) input.galleryId = galleryId;
  if (enabled !== undefined) input.enabled = enabled;
  if (autoCreateGallery !== undefined) input.autoCreateGallery = autoCreateGallery;
  if (autoSyncGalleryAfterDownload !== undefined) {
    input.autoSyncGalleryAfterDownload = autoSyncGalleryAfterDownload;
  }
  if (quality !== undefined) input.quality = quality;
  if (perPage !== undefined) input.perPage = perPage;
  if (concurrency !== undefined) input.concurrency = concurrency;
  if (skipIfExists !== undefined) input.skipIfExists = skipIfExists;
  if (notifications !== undefined) input.notifications = notifications;
  if (blacklistedTags !== undefined) input.blacklistedTags = blacklistedTags;

  return input;
}

function unwrapControlResult(result: ServiceControlResult): void {
  if (!result.success) {
    throw new ApiHttpError(500, 'INTERNAL_ERROR', 'Download session control failed');
  }
}

async function getSessionOrThrow(sessionId: string) {
  const sessions = await callService(
    () => getActiveBulkDownloadSessions(),
    'Failed to load download sessions',
  );
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    notFound();
  }

  return session;
}

export function createBooruRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/booru-sites',
      handler: async () => toSafeBooruSites(await callService(
        () => getBooruSites(),
        'Failed to load booru sites',
      )),
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-sites/active',
      handler: async () => toSafeBooruSite(await callService(
        () => getActiveBooruSite(),
        'Failed to load active booru site',
      )),
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/search',
      handler: (context) => {
        const siteId = requiredNumberQuery(context, 'siteId');
        const tags = tagsFromPost(context.query.get('tags') ?? '');
        const page = requiredPageQuery(context, 1);
        const limit = requiredLimitQuery(context, 20);

        return callService(
          () => searchBooruPosts(siteId, tags, page, limit),
          'Failed to search booru posts',
        );
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/:siteId/:postId',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        return getPostOrThrow(siteId, postId);
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/:siteId/:postId/tags',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        const post = await getPostOrThrow(siteId, postId);

        return { tags: tagsFromPost(post.tags) };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/:siteId/:postId/favorite-info',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        const post = await getPostOrThrow(siteId, postId);

        return {
          isFavorited: Boolean(post.isFavorited),
          isLiked: Boolean(post.isLiked),
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/favorites',
      handler: (context) => {
        const siteId = requiredNumberQuery(context, 'siteId');
        const page = requiredPageQuery(context, 1);
        const limit = requiredLimitQuery(context, 20);
        const groupId = optionalNullableNumberQuery(context, 'groupId');

        return callService(
          () => getFavorites(siteId, page, limit, groupId),
          'Failed to load favorites',
        );
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorites/:siteId/:postId',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        const body = await jsonObject(context);
        const notes = favoriteCreateNotes(body);
        await getPostOrThrow(siteId, postId);
        const id = await callService(
          () => addToFavorites(postId, siteId, notes),
          'Failed to add favorite',
        );

        return { id };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorites/:siteId/:postId',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        await getPostOrThrow(siteId, postId);
        await callService(() => removeFromFavorites(postId, siteId), 'Failed to remove favorite');
        return { removed: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorites/:siteId/:postId/like',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        await getPostOrThrow(siteId, postId);
        await callService(() => setPostLiked(siteId, postId, true), 'Failed to update favorite like');
        return { liked: true };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorites/:siteId/:postId/like',
      handler: async (context) => {
        const siteId = numberParam(context.params.siteId, 'siteId');
        const postId = numberParam(context.params.postId, 'postId');
        await getPostOrThrow(siteId, postId);
        await callService(() => setPostLiked(siteId, postId, false), 'Failed to update favorite like');
        return { liked: false };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/favorite-tags',
      handler: (context) => callService(
        () => getFavoriteTagsWithDownloadState(favoriteTagListQuery(context)),
        'Failed to load favorite tags',
      ),
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorite-tags',
      handler: async (context) => {
        const body = await jsonObject(context);
        const tagName = optionalString(body.tagName)?.trim();
        if (!tagName) {
          validationError('tagName is required');
        }

        const siteId = nullableNumberBody(body.siteId, 'siteId', null);
        return callService(
          () => addFavoriteTag(siteId, tagName, favoriteTagOptions(body)),
          'Failed to add favorite tag',
        );
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/v1/favorite-tags/:id',
      handler: async (context) => {
        const id = numberParam(context.params.id, 'id');
        const body = await jsonObject(context);
        await assertFavoriteTagExists(id);
        const updates = favoriteTagPatchInput(body);
        await callService(
          () => updateFavoriteTag(id, updates as Parameters<typeof updateFavoriteTag>[1]),
          'Failed to update favorite tag',
        );

        return { updated: true };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorite-tags/:id',
      handler: async (context) => {
        const id = numberParam(context.params.id, 'id');
        await callService(() => removeFavoriteTag(id), 'Failed to remove favorite tag');
        return { removed: true };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/favorite-tags/:id/binding',
      handler: async (context) => {
        const id = numberParam(context.params.id, 'id');
        const binding = await callService(
          () => getFavoriteTagDownloadBinding(id),
          'Failed to load favorite tag binding',
        );
        if (!binding) {
          notFound();
        }

        return binding;
      },
    },
    {
      method: 'PUT',
      pattern: '/api/v1/favorite-tags/:id/binding',
      handler: async (context) => {
        const id = numberParam(context.params.id, 'id');
        const body = await jsonObject(context);
        const input = bindingInput(id, body);
        await assertFavoriteTagExists(id);
        return callService(
          () => upsertFavoriteTagDownloadBinding(input),
          'Failed to save favorite tag binding',
        );
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorite-tags/:id/binding',
      handler: async (context) => {
        const id = numberParam(context.params.id, 'id');
        const binding = await callService(
          () => getFavoriteTagDownloadBinding(id),
          'Failed to load favorite tag binding',
        );
        if (!binding) {
          notFound();
        }

        await callService(
          () => deleteFavoriteTagDownloadBinding(id),
          'Failed to remove favorite tag binding',
        );
        return { removed: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorite-tags/:id/bulk-download',
      handler: async (context) => {
        const id = numberParam(context.params.id, 'id');
        const binding = await callService(
          () => getFavoriteTagDownloadBinding(id),
          'Failed to load favorite tag binding',
        );
        if (!binding) {
          notFound();
        }
        if (binding.enabled === false) {
          validationError('Favorite tag download binding is disabled');
        }

        return callService(
          () => startFavoriteTagBulkDownload(id),
          'Failed to start favorite tag bulk download',
        );
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/downloads/queue',
      handler: (context) => callService(
        () => getDownloadQueueForDisplay(context.query.get('status') ?? undefined),
        'Failed to load download queue',
      ),
    },
    {
      method: 'GET',
      pattern: '/api/v1/downloads/tasks',
      handler: () => callService(() => getBulkDownloadTasks(), 'Failed to load download tasks'),
    },
    {
      method: 'GET',
      pattern: '/api/v1/downloads/tasks/:taskId',
      handler: async (context) => {
        const task = await callService(
          () => getBulkDownloadTaskById(context.params.taskId),
          'Failed to load download task',
        );
        if (!task) {
          notFound();
        }

        return task;
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/downloads/sessions',
      handler: () => callService(
        () => getActiveBulkDownloadSessions(),
        'Failed to load download sessions',
      ),
    },
    {
      method: 'GET',
      pattern: '/api/v1/downloads/sessions/:sessionId',
      handler: async (context) => {
        const sessions = await callService(
          () => getActiveBulkDownloadSessions(),
          'Failed to load download sessions',
        );
        const session = sessions.find((candidate) => candidate.id === context.params.sessionId);
        if (!session) {
          notFound();
        }

        return session;
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/downloads/sessions/:sessionId/pause',
      handler: async (context) => {
        await getSessionOrThrow(context.params.sessionId);
        const result = await callService(
          () => pauseBulkDownloadSession(context.params.sessionId),
          'Download session control failed',
        );
        unwrapControlResult(result);
        return { paused: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/downloads/sessions/:sessionId/resume',
      handler: async (context) => {
        await getSessionOrThrow(context.params.sessionId);
        const result = await callService(
          () => startBulkDownloadSession(context.params.sessionId),
          'Download session control failed',
        );
        unwrapControlResult(result);

        return result.queued === undefined
          ? { resumed: true }
          : { resumed: true, queued: result.queued };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/downloads/sessions/:sessionId/cancel',
      handler: async (context) => {
        await getSessionOrThrow(context.params.sessionId);
        const result = await callService(
          () => cancelBulkDownloadSession(context.params.sessionId),
          'Download session control failed',
        );
        unwrapControlResult(result);
        return { cancelled: true };
      },
    },
  ];
}
