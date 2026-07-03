import { API_EVENT_CHANNELS, type ApiServicePermissionKey } from '../../shared/types.js';

interface ApiPermissionRule {
  method: string;
  path: RegExp;
  permissionKey: ApiServicePermissionKey | null;
}

const eventChannelPattern = API_EVENT_CHANNELS.join('|');

const apiPermissionRules: ApiPermissionRule[] = [
  { method: 'GET', path: /^\/api\/v1\/service\/info\/?$/, permissionKey: null },
  { method: 'GET', path: /^\/api\/v1\/service\/health\/?$/, permissionKey: null },

  { method: 'GET', path: /^\/api\/v1\/galleries(?:\/[^/]+(?:\/images)?)?\/?$/, permissionKey: 'galleryRead' },
  { method: 'GET', path: /^\/api\/v1\/images(?:\/[^/]+)?\/?$/, permissionKey: 'imageRead' },
  { method: 'GET', path: /^\/api\/v1\/images\/[^/]+\/(?:thumbnail|preview|file)\/?$/, permissionKey: 'imageBinary' },

  { method: 'GET', path: /^\/api\/v1\/booru-sites(?:\/active)?\/?$/, permissionKey: 'booruRead' },
  { method: 'GET', path: /^\/api\/v1\/booru-posts\/search\/?$/, permissionKey: 'booruRead' },
  { method: 'GET', path: /^\/api\/v1\/booru-posts\/[^/]+\/[^/]+(?:\/(?:tags|favorite-info))?\/?$/, permissionKey: 'booruRead' },
  { method: 'GET', path: /^\/api\/v1\/favorites\/?$/, permissionKey: 'booruRead' },
  { method: 'POST', path: /^\/api\/v1\/favorites\/[^/]+\/[^/]+(?:\/like)?\/?$/, permissionKey: 'booruWrite' },
  { method: 'DELETE', path: /^\/api\/v1\/favorites\/[^/]+\/[^/]+(?:\/like)?\/?$/, permissionKey: 'booruWrite' },

  { method: 'GET', path: /^\/api\/v1\/favorite-tags(?:\/[^/]+\/binding)?\/?$/, permissionKey: 'favoriteTagsRead' },
  { method: 'POST', path: /^\/api\/v1\/favorite-tags\/?$/, permissionKey: 'favoriteTagsWrite' },
  { method: 'PATCH', path: /^\/api\/v1\/favorite-tags\/[^/]+\/?$/, permissionKey: 'favoriteTagsWrite' },
  { method: 'DELETE', path: /^\/api\/v1\/favorite-tags\/[^/]+\/?$/, permissionKey: 'favoriteTagsWrite' },
  { method: 'PUT', path: /^\/api\/v1\/favorite-tags\/[^/]+\/binding\/?$/, permissionKey: 'favoriteTagsWrite' },
  { method: 'DELETE', path: /^\/api\/v1\/favorite-tags\/[^/]+\/binding\/?$/, permissionKey: 'favoriteTagsWrite' },
  { method: 'POST', path: /^\/api\/v1\/favorite-tags\/[^/]+\/bulk-download\/?$/, permissionKey: 'downloadsControl' },

  { method: 'GET', path: /^\/api\/v1\/downloads\/queue\/?$/, permissionKey: 'downloadsRead' },
  { method: 'GET', path: /^\/api\/v1\/downloads\/tasks(?:\/[^/]+)?\/?$/, permissionKey: 'downloadsRead' },
  { method: 'GET', path: /^\/api\/v1\/downloads\/sessions(?:\/[^/]+)?\/?$/, permissionKey: 'downloadsRead' },
  { method: 'POST', path: /^\/api\/v1\/downloads\/sessions\/[^/]+\/(?:pause|resume|cancel)\/?$/, permissionKey: 'downloadsControl' },

  { method: 'GET', path: new RegExp(`^/api/v1/events/(?:${eventChannelPattern})/?$`), permissionKey: 'eventsSubscribe' },
  { method: 'GET', path: /^\/api\/v1\/api-logs\/?$/, permissionKey: 'apiLogsRead' },
];

export function resolvePermissionForRequest(
  method: string,
  pathname: string,
): ApiServicePermissionKey | null | undefined {
  const normalizedMethod = method.toUpperCase();
  const rule = apiPermissionRules.find((candidate) => (
    candidate.method === normalizedMethod && candidate.path.test(pathname)
  ));

  return rule?.permissionKey;
}
