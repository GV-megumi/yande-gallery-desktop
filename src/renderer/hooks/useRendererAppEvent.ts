import { useEffect, useRef } from 'react';
import type { RendererAppEvent } from '../../shared/types';

type EventType = RendererAppEvent['type'];
type EventOf<TType extends EventType> = Extract<RendererAppEvent, { type: TType }>;

/**
 * 挂起期间单个事件类型最多缓冲的事件数。
 * 超过后该类型进入「溢出」状态：丢弃已缓冲的同类事件，只保留最新一条。
 * 背景：App.tsx 导航缓存会让页面长期保持挂载但 inactive，批量下载等场景
 * 可能在挂起期间产生数千条同类事件，无上限缓冲会持续占用内存，
 * 且恢复激活时逐条同步回放会冻结 UI。
 */
const MAX_DIRTY_EVENTS_PER_TYPE = 50;

interface DirtyEventBuffer<TEvent> {
  /** 未溢出类型的事件，按到达顺序保存 */
  events: TEvent[];
  /** 各事件类型当前在 events 中的缓冲数量 */
  counts: Map<EventType, number>;
  /** 已溢出类型 → 该类型最新一条事件 */
  overflowedLatest: Map<EventType, TEvent>;
}

function createDirtyEventBuffer<TEvent>(): DirtyEventBuffer<TEvent> {
  return { events: [], counts: new Map(), overflowedLatest: new Map() };
}

export function useRendererAppEvent<TType extends EventType>(
  type: TType | readonly TType[],
  onEvent: (event: EventOf<TType>) => void,
  options: { active?: boolean; replayDirtyOnActive?: boolean } = {},
): void {
  const active = options.active ?? true;
  const replayDirtyOnActive = options.replayDirtyOnActive ?? true;
  const onEventRef = useRef(onEvent);
  const activeRef = useRef(active);
  const dirtyBufferRef = useRef<DirtyEventBuffer<EventOf<TType>>>(createDirtyEventBuffer());
  const types = Array.isArray(type) ? type : [type];
  const typeKey = types.join('|');

  onEventRef.current = onEvent;
  activeRef.current = active;

  useEffect(() => {
    dirtyBufferRef.current = createDirtyEventBuffer();
  }, [typeKey]);

  useEffect(() => {
    if (!active || !replayDirtyOnActive) return;
    const buffer = dirtyBufferRef.current;
    if (buffer.events.length === 0 && buffer.overflowedLatest.size === 0) return;
    dirtyBufferRef.current = createDirtyEventBuffer();
    // 未溢出类型：按到达顺序逐条回放
    for (const event of buffer.events) {
      onEventRef.current(event);
    }
    // 溢出类型：只回放最新一条。
    // 取舍说明：refetch 型 handler（如 loadFavorites）收到一条事件就会整体刷新，
    // 回放 N 条只会触发 N 次重复请求；patch 型 handler 在溢出后会丢失部分增量补丁，
    // 但相比无上限缓冲 + 同步逐条回放导致的内存增长与 UI 冻结，这是可接受的代价。
    for (const event of buffer.overflowedLatest.values()) {
      onEventRef.current(event);
    }
  }, [active, replayDirtyOnActive]);

  useEffect(() => {
    const allowedTypes = new Set<EventType>(types);
    const unsubscribe = window.electronAPI?.system?.onAppEvent?.((event: RendererAppEvent) => {
      if (!allowedTypes.has(event.type)) return;

      const typedEvent = event as EventOf<TType>;
      if (!activeRef.current) {
        if (replayDirtyOnActive) {
          const buffer = dirtyBufferRef.current;
          if (buffer.overflowedLatest.has(typedEvent.type)) {
            // 该类型已溢出：只更新最新一条，不再追加缓冲
            buffer.overflowedLatest.set(typedEvent.type, typedEvent);
            return;
          }
          const count = buffer.counts.get(typedEvent.type) ?? 0;
          if (count >= MAX_DIRTY_EVENTS_PER_TYPE) {
            // 缓冲溢出：丢弃该类型已缓冲的全部事件，转为只保留最新一条
            console.warn(
              `[useRendererAppEvent] 挂起期间 "${typedEvent.type}" 缓冲事件超过 ${MAX_DIRTY_EVENTS_PER_TYPE} 条，` +
              '已丢弃该类型旧事件，恢复激活时只回放最新一条',
            );
            buffer.events = buffer.events.filter((item) => item.type !== typedEvent.type);
            buffer.counts.delete(typedEvent.type);
            buffer.overflowedLatest.set(typedEvent.type, typedEvent);
            return;
          }
          buffer.events.push(typedEvent);
          buffer.counts.set(typedEvent.type, count + 1);
        }
        return;
      }

      onEventRef.current(typedEvent);
    });

    return () => unsubscribe?.();
  }, [typeKey, replayDirtyOnActive]);
}
