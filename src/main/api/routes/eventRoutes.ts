import type { ApiEventChannel, ApiEventHub } from '../events/eventHub.js';
import { ApiHttpError, type ApiRoute } from '../types.js';
import { API_EVENT_CHANNELS } from '../../../shared/types.js';
import { APP_API_PREFIX } from '../appNamespace.js';

const ALLOWED_CHANNELS = new Set<ApiEventChannel>(API_EVENT_CHANNELS);

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

/** 手机面只挂 system 单频道（最小暴露面，spec §3.1）；agent 面保留全频道参数路由。 */
export function createAppEventRoutes(eventHub: Pick<ApiEventHub, 'subscribe'>): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: `${APP_API_PREFIX}/events/system`,
      handler: (context) => {
        eventHub.subscribe('system', context.req, context.res);
        return undefined;
      },
    },
  ];
}
