import type { ApiEventChannel, ApiEventHub } from '../events/eventHub.js';
import { ApiHttpError, type ApiRoute } from '../types.js';

const ALLOWED_CHANNELS = new Set<ApiEventChannel>([
  'downloads',
  'favorite-tags',
  'booru',
  'api-logs',
  'system',
]);

function eventChannel(value: string | undefined): ApiEventChannel {
  if (value && ALLOWED_CHANNELS.has(value as ApiEventChannel)) {
    return value as ApiEventChannel;
  }

  throw new ApiHttpError(404, 'NOT_FOUND', 'Event channel not found');
}

export function createEventRoutes(eventHub: Pick<ApiEventHub, 'subscribe'>): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/events/:channel',
      handler: (context) => {
        eventHub.subscribe(eventChannel(context.params.channel), context.req, context.res);
        return undefined;
      },
    },
  ];
}
