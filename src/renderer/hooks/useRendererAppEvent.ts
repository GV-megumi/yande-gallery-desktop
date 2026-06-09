import { useEffect, useRef } from 'react';
import type { RendererAppEvent } from '../../shared/types';

type EventType = RendererAppEvent['type'];
type EventOf<TType extends EventType> = Extract<RendererAppEvent, { type: TType }>;

export function useRendererAppEvent<TType extends EventType>(
  type: TType | readonly TType[],
  onEvent: (event: EventOf<TType>) => void,
  options: { active?: boolean; replayDirtyOnActive?: boolean } = {},
): void {
  const active = options.active ?? true;
  const replayDirtyOnActive = options.replayDirtyOnActive ?? true;
  const onEventRef = useRef(onEvent);
  const activeRef = useRef(active);
  const dirtyEventsRef = useRef<Array<EventOf<TType>>>([]);
  const types = Array.isArray(type) ? type : [type];
  const typeKey = types.join('|');

  onEventRef.current = onEvent;
  activeRef.current = active;

  useEffect(() => {
    dirtyEventsRef.current = [];
  }, [typeKey]);

  useEffect(() => {
    if (!active || !replayDirtyOnActive || dirtyEventsRef.current.length === 0) return;
    const dirtyEvents = dirtyEventsRef.current;
    dirtyEventsRef.current = [];
    for (const event of dirtyEvents) {
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
          dirtyEventsRef.current.push(typedEvent);
        }
        return;
      }

      onEventRef.current(typedEvent);
    });

    return () => unsubscribe?.();
  }, [typeKey, replayDirtyOnActive]);
}
