import { describe, expect, it } from 'vitest';
import { resolvePermissionForRequest } from '../../../src/main/api/permissions.js';

describe('api permission mapping', () => {
  it.each([
    ['GET', '/api/v1/galleries', 'galleryRead'],
    ['GET', '/api/v1/galleries/1', 'galleryRead'],
    ['GET', '/api/v1/galleries/1/images', 'galleryRead'],
    ['GET', '/api/v1/images', 'imageRead'],
    ['GET', '/api/v1/images/5', 'imageRead'],
    ['GET', '/api/v1/images/5/thumbnail', 'imageBinary'],
    ['GET', '/api/v1/images/5/preview', 'imageBinary'],
    ['GET', '/api/v1/images/5/file', 'imageBinary'],
    ['GET', '/api/v1/booru-sites', 'booruRead'],
    ['GET', '/api/v1/booru-sites/active', 'booruRead'],
    ['GET', '/api/v1/booru-posts/search', 'booruRead'],
    ['GET', '/api/v1/booru-posts/1/2', 'booruRead'],
    ['GET', '/api/v1/booru-posts/1/2/tags', 'booruRead'],
    ['GET', '/api/v1/booru-posts/1/2/favorite-info', 'booruRead'],
    ['GET', '/api/v1/favorites', 'booruRead'],
    ['POST', '/api/v1/favorites/1/2', 'booruWrite'],
    ['DELETE', '/api/v1/favorites/1/2', 'booruWrite'],
    ['POST', '/api/v1/favorites/1/2/like', 'booruWrite'],
    ['DELETE', '/api/v1/favorites/1/2/like', 'booruWrite'],
    ['GET', '/api/v1/favorite-tags', 'favoriteTagsRead'],
    ['GET', '/api/v1/favorite-tags/9/binding', 'favoriteTagsRead'],
    ['POST', '/api/v1/favorite-tags', 'favoriteTagsWrite'],
    ['PATCH', '/api/v1/favorite-tags/9', 'favoriteTagsWrite'],
    ['DELETE', '/api/v1/favorite-tags/9', 'favoriteTagsWrite'],
    ['PUT', '/api/v1/favorite-tags/9/binding', 'favoriteTagsWrite'],
    ['DELETE', '/api/v1/favorite-tags/9/binding', 'favoriteTagsWrite'],
    ['POST', '/api/v1/favorite-tags/9/bulk-download', 'downloadsControl'],
    ['GET', '/api/v1/downloads/queue', 'downloadsRead'],
    ['GET', '/api/v1/downloads/tasks', 'downloadsRead'],
    ['GET', '/api/v1/downloads/tasks/task-1', 'downloadsRead'],
    ['GET', '/api/v1/downloads/sessions', 'downloadsRead'],
    ['GET', '/api/v1/downloads/sessions/session-1', 'downloadsRead'],
    ['POST', '/api/v1/downloads/sessions/session-1/pause', 'downloadsControl'],
    ['POST', '/api/v1/downloads/sessions/session-1/resume', 'downloadsControl'],
    ['POST', '/api/v1/downloads/sessions/session-1/cancel', 'downloadsControl'],
    ['GET', '/api/v1/events/downloads', 'eventsSubscribe'],
    ['GET', '/api/v1/events/favorite-tags', 'eventsSubscribe'],
    ['GET', '/api/v1/events/booru', 'eventsSubscribe'],
    ['GET', '/api/v1/events/api-logs', 'eventsSubscribe'],
    ['GET', '/api/v1/events/system', 'eventsSubscribe'],
    ['GET', '/api/v1/api-logs', 'apiLogsRead'],
  ] as const)('maps %s %s to %s', (method, pathname, permission) => {
    expect(resolvePermissionForRequest(method, pathname)).toBe(permission);
  });

  it.each([
    ['GET', '/api/v1/images/not-a-number/file', 'imageBinary'],
    ['GET', '/api/v1/images/not-a-number', 'imageRead'],
    ['GET', '/api/v1/galleries/not-a-number/images', 'galleryRead'],
    ['GET', '/api/v1/booru-posts/site/post/tags', 'booruRead'],
    ['POST', '/api/v1/favorites/site/post/like', 'booruWrite'],
    ['PATCH', '/api/v1/favorite-tags/not-a-number', 'favoriteTagsWrite'],
    ['GET', '/api/v1/favorite-tags/not-a-number/binding', 'favoriteTagsRead'],
  ] as const)('maps non-numeric route parameter %s %s to %s', (method, pathname, permission) => {
    expect(resolvePermissionForRequest(method, pathname)).toBe(permission);
  });

  it.each([
    ['GET', '/api/v1/service/info'],
    ['GET', '/api/v1/service/health'],
  ] as const)('does not require module permission for service endpoint %s %s', (method, pathname) => {
    expect(resolvePermissionForRequest(method, pathname)).toBeNull();
  });

  it.each([
    ['GET', '/api/v1'],
    ['GET', '/api/v1/'],
    ['GET', '/api/v1/info'],
    ['GET', '/api/v1/health'],
    ['GET', '/api/v1/service'],
    ['GET', '/api/v1/status'],
    ['GET', '/api/v1/config'],
    ['GET', '/api/v1/system'],
  ] as const)('does not map unplanned service alias %s %s', (method, pathname) => {
    expect(resolvePermissionForRequest(method, pathname)).toBeUndefined();
  });

  it('returns undefined for unknown endpoints', () => {
    expect(resolvePermissionForRequest('GET', '/api/v1/unknown')).toBeUndefined();
  });
});
