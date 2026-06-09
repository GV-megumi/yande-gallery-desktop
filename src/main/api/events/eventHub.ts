import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import type { ApiEventChannel } from '../../../shared/types.js';

export type { ApiEventChannel };

export interface ApiEventPayload {
  eventId?: string;
  type: string;
  timestamp?: string;
  data: unknown;
}

interface ApiEventEnvelope {
  eventId: string;
  type: string;
  timestamp: string;
  data: unknown;
}

export class ApiEventHub {
  private readonly clients = new Map<ApiEventChannel, Set<ServerResponse>>();
  private readonly cleanupByClient = new Map<ServerResponse, () => void>();

  subscribe(channel: ApiEventChannel, req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();

    const clients = this.getChannelClients(channel);
    clients.add(res);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clients.delete(res);
      this.cleanupByClient.delete(res);
      req.off('close', cleanup);
      res.off('close', cleanup);
      res.off('error', cleanup);
    };
    this.cleanupByClient.set(res, cleanup);

    req.once('close', cleanup);
    res.once('close', cleanup);
    res.once('error', cleanup);

    try {
      res.write(formatSseFrame({ type: 'ready', data: { channel } }), (error?: Error | null) => {
        if (error) {
          cleanup();
        }
      });
    } catch {
      cleanup();
    }
  }

  publish(channel: ApiEventChannel, payload: ApiEventPayload): void {
    const clients = this.clients.get(channel);
    if (!clients) {
      return;
    }

    const frame = formatSseFrame(payload);
    for (const client of [...clients]) {
      if (client.destroyed || client.writableEnded) {
        this.removeClient(clients, client);
        continue;
      }

      try {
        client.write(frame, (error?: Error | null) => {
          if (error) {
            this.removeClient(clients, client);
          }
        });
      } catch {
        this.removeClient(clients, client);
      }
    }
  }

  closeAll(): void {
    const clients = [...this.cleanupByClient.keys()];
    for (const client of clients) {
      const cleanup = this.cleanupByClient.get(client);
      cleanup?.();

      if (client.destroyed || client.writableEnded) {
        continue;
      }

      try {
        client.end();
      } catch {
        if (!client.destroyed) {
          client.destroy();
        }
      }
    }

    this.clients.clear();
    this.cleanupByClient.clear();
  }

  private getChannelClients(channel: ApiEventChannel): Set<ServerResponse> {
    let clients = this.clients.get(channel);
    if (!clients) {
      clients = new Set<ServerResponse>();
      this.clients.set(channel, clients);
    }
    return clients;
  }

  private removeClient(clients: Set<ServerResponse>, client: ServerResponse): void {
    const cleanup = this.cleanupByClient.get(client);
    if (cleanup) {
      cleanup();
      return;
    }
    clients.delete(client);
  }
}

const EVENT_NAME_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function validateEventType(type: string): void {
  if (!EVENT_NAME_PATTERN.test(type)) {
    throw new TypeError(`Invalid API event type: ${JSON.stringify(type)}`);
  }
}

function createEnvelope(payload: ApiEventPayload): ApiEventEnvelope {
  return {
    eventId: payload.eventId ?? randomUUID(),
    type: payload.type,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    data: payload.data,
  };
}

function formatSseFrame(payload: ApiEventPayload): string {
  validateEventType(payload.type);
  const envelope = createEnvelope(payload);
  return `event: ${payload.type}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export const apiEventHub = new ApiEventHub();
