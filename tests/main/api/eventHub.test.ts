import type { IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { ApiEventHub } from '../../../src/main/api/events/eventHub.js';

type MockRequest = IncomingMessage & EventEmitter;

type MockResponse = ServerResponse & {
  headers: Record<string, string | number | readonly string[]>;
  frames: string[];
  end: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

function createMockRequest(): MockRequest {
  return new EventEmitter() as MockRequest;
}

function createMockResponse(): MockResponse {
  const response = Object.assign(new EventEmitter(), {
    headers: {} as Record<string, string | number | readonly string[]>,
    frames: [] as string[],
    destroyed: false,
    writableEnded: false,
    end: vi.fn((callback?: () => void) => {
      response.writableEnded = true;
      response.emit('close');
      callback?.();
      return response;
    }),
    flushHeaders: vi.fn(),
    setHeader: vi.fn((name: string, value: string | number | readonly string[]) => {
      response.headers[name.toLowerCase()] = value;
      return response;
    }),
    write: vi.fn((frame: string, callback?: (error?: Error | null) => void) => {
      response.frames.push(frame);
      callback?.();
      return true;
    }),
  });

  return response as unknown as MockResponse;
}

function parseFrame(frame: string): { event: string; envelope: Record<string, unknown> } {
  const lines = frame.split('\n');
  expect(lines[0]).toMatch(/^event: .+$/);
  expect(lines[1]).toMatch(/^data: .+$/);
  expect(lines[2]).toBe('');
  expect(lines[3]).toBe('');

  return {
    event: lines[0].slice('event: '.length),
    envelope: JSON.parse(lines[1].slice('data: '.length)) as Record<string, unknown>,
  };
}

describe('ApiEventHub', () => {
  it('subscribes with SSE headers and writes a ready frame', () => {
    const hub = new ApiEventHub();
    const req = createMockRequest();
    const res = createMockResponse();

    hub.subscribe('downloads', req, res);

    expect(res.headers).toEqual({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledTimes(1);

    const ready = parseFrame(res.frames[0]);
    expect(ready.event).toBe('ready');
    expect(ready.envelope).toMatchObject({
      type: 'ready',
      data: { channel: 'downloads' },
    });
    expect(typeof ready.envelope.eventId).toBe('string');
    expect(typeof ready.envelope.timestamp).toBe('string');
  });

  it('publishes event frames to subscribed clients', () => {
    const hub = new ApiEventHub();
    const req = createMockRequest();
    const res = createMockResponse();
    hub.subscribe('downloads', req, res);

    hub.publish('downloads', { type: 'progress', data: { id: 7, percent: 50 } });

    expect(res.write).toHaveBeenCalledTimes(2);
    const event = parseFrame(res.frames[1]);
    expect(event.event).toBe('progress');
    expect(event.envelope).toMatchObject({
      type: 'progress',
      data: { id: 7, percent: 50 },
    });
    expect(typeof event.envelope.eventId).toBe('string');
    expect(typeof event.envelope.timestamp).toBe('string');
  });

  it('accepts colon-delimited event names for subscribed clients', () => {
    const hub = new ApiEventHub();
    const req = createMockRequest();
    const res = createMockResponse();
    hub.subscribe('downloads', req, res);

    expect(() => {
      hub.publish('downloads', {
        type: 'bulk-download:sessions-changed',
        data: { sessionId: 's1' },
      });
    }).not.toThrow();

    expect(res.write).toHaveBeenCalledTimes(2);
    const event = parseFrame(res.frames[1]);
    expect(event.event).toBe('bulk-download:sessions-changed');
    expect(event.envelope).toMatchObject({
      type: 'bulk-download:sessions-changed',
      data: { sessionId: 's1' },
    });
  });

  it('does not publish to clients on other channels', () => {
    const hub = new ApiEventHub();
    const downloads = createMockResponse();
    const system = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), downloads);
    hub.subscribe('system', createMockRequest(), system);

    hub.publish('downloads', { type: 'progress', data: { id: 1 } });

    expect(downloads.write).toHaveBeenCalledTimes(2);
    expect(system.write).toHaveBeenCalledTimes(1);
    expect(parseFrame(system.frames[0]).event).toBe('ready');
  });

  it('removes a client on request close', () => {
    const hub = new ApiEventHub();
    const req = createMockRequest();
    const res = createMockResponse();
    hub.subscribe('downloads', req, res);

    req.emit('close');
    hub.publish('downloads', { type: 'progress', data: { id: 1 } });

    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('removes a client on response close', () => {
    const hub = new ApiEventHub();
    const res = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), res);

    res.emit('close');
    hub.publish('downloads', { type: 'progress', data: { id: 1 } });

    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('removes a client on response error', () => {
    const hub = new ApiEventHub();
    const res = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), res);

    res.emit('error', new Error('closed'));
    hub.publish('downloads', { type: 'progress', data: { id: 1 } });

    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('skips and removes destroyed or ended clients before writing', () => {
    const hub = new ApiEventHub();
    const destroyed = createMockResponse();
    const ended = createMockResponse();
    const healthy = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), destroyed);
    hub.subscribe('downloads', createMockRequest(), ended);
    hub.subscribe('downloads', createMockRequest(), healthy);
    destroyed.destroyed = true;
    ended.writableEnded = true;

    hub.publish('downloads', { type: 'progress', data: { id: 1 } });

    expect(destroyed.write).toHaveBeenCalledTimes(1);
    expect(ended.write).toHaveBeenCalledTimes(1);
    expect(healthy.write).toHaveBeenCalledTimes(2);

    hub.publish('downloads', { type: 'complete', data: { id: 1 } });

    expect(destroyed.write).toHaveBeenCalledTimes(1);
    expect(ended.write).toHaveBeenCalledTimes(1);
    expect(healthy.write).toHaveBeenCalledTimes(3);
  });

  it('removes clients that throw on write and continues publishing to other clients', () => {
    const hub = new ApiEventHub();
    const failed = createMockResponse();
    const healthy = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), failed);
    hub.subscribe('downloads', createMockRequest(), healthy);
    failed.write.mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    expect(() => {
      hub.publish('downloads', { type: 'progress', data: { id: 1 } });
    }).not.toThrow();

    expect(failed.write).toHaveBeenCalledTimes(2);
    expect(healthy.write).toHaveBeenCalledTimes(2);
    expect(parseFrame(healthy.frames[1]).event).toBe('progress');

    hub.publish('downloads', { type: 'complete', data: { id: 1 } });

    expect(failed.write).toHaveBeenCalledTimes(2);
    expect(healthy.write).toHaveBeenCalledTimes(3);
    expect(parseFrame(healthy.frames[2]).event).toBe('complete');
  });

  it('removes clients from async write callback errors without blocking healthy clients', () => {
    const hub = new ApiEventHub();
    const failed = createMockResponse();
    const healthy = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), failed);
    hub.subscribe('downloads', createMockRequest(), healthy);
    failed.write.mockImplementationOnce((frame: string, callback?: (error?: Error | null) => void) => {
      failed.frames.push(frame);
      callback?.(new Error('write callback failed'));
      return false;
    });

    hub.publish('downloads', { type: 'progress', data: { id: 1 } });

    expect(failed.write).toHaveBeenCalledTimes(2);
    expect(healthy.write).toHaveBeenCalledTimes(2);
    expect(parseFrame(healthy.frames[1]).event).toBe('progress');

    hub.publish('downloads', { type: 'complete', data: { id: 1 } });

    expect(failed.write).toHaveBeenCalledTimes(2);
    expect(healthy.write).toHaveBeenCalledTimes(3);
    expect(parseFrame(healthy.frames[2]).event).toBe('complete');
  });

  it('closes all subscribed SSE clients and removes them from future publishes', () => {
    const hub = new ApiEventHub();
    const downloads = createMockResponse();
    const system = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), downloads);
    hub.subscribe('system', createMockRequest(), system);

    hub.closeAll();

    expect(downloads.end).toHaveBeenCalledTimes(1);
    expect(system.end).toHaveBeenCalledTimes(1);

    hub.publish('downloads', { type: 'progress', data: { id: 1 } });
    hub.publish('system', { type: 'status', data: { ok: true } });

    expect(downloads.write).toHaveBeenCalledTimes(1);
    expect(system.write).toHaveBeenCalledTimes(1);
  });

  it('preserves payload eventId and timestamp in the envelope', () => {
    const hub = new ApiEventHub();
    const res = createMockResponse();
    hub.subscribe('api-logs', createMockRequest(), res);

    hub.publish('api-logs', {
      eventId: 'fixed-id',
      type: 'log',
      timestamp: '2026-05-23T00:00:00.000Z',
      data: { message: 'ok' },
    });

    const event = parseFrame(res.frames[1]);
    expect(event.envelope).toEqual({
      eventId: 'fixed-id',
      type: 'log',
      timestamp: '2026-05-23T00:00:00.000Z',
      data: { message: 'ok' },
    });
  });

  it('rejects invalid event names without writing injected frames', () => {
    const hub = new ApiEventHub();
    const res = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), res);

    expect(() => {
      hub.publish('downloads', { type: 'bad\nevent', data: {} });
    }).toThrow(TypeError);

    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('allows dotted and hyphenated event names', () => {
    const hub = new ApiEventHub();
    const res = createMockResponse();
    hub.subscribe('downloads', createMockRequest(), res);

    hub.publish('downloads', { type: 'downloads.session-updated', data: { id: 1 } });

    expect(res.write).toHaveBeenCalledTimes(2);
    expect(parseFrame(res.frames[1]).event).toBe('downloads.session-updated');
  });
});
