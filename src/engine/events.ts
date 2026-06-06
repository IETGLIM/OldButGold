// ─── Typed Event Bus ───
// Minimal but fully typed pub/sub with deduplication

type Handler<T = unknown> = (payload: T) => void;

interface EventDef {
  payload: unknown;
}

export interface GameEventMap extends Record<string, EventDef> {
  'scene:change': { payload: { scene: string; from?: string } };
  'scene:ready': { payload: { scene: string } };
  'intro:poem-line': { payload: { index: number; text: string } };
  'intro:poem-complete': { payload: {} };
  'intro:matrix-done': { payload: {} };
  'intro:skip': { payload: {} };
  'player:spawned': { payload: {} };
  'player:grounded': { payload: {} };
  'player:position': { payload: { x: number; y: number; z: number } };
  'interaction:hover': { payload: { target: string } };
  'interaction:select': { payload: { target: string } };
  'cutscene:start': { payload: { id: string } };
  'cutscene:end': { payload: { id: string } };
  'transition:start': { payload: { from: string; to: string } };
  'transition:complete': { payload: { to: string } };
}

interface Subscription {
  handler: Handler;
  once: boolean;
}

export function createEventBus<E extends Record<string, EventDef>>() {
  const handlers = new Map<string, Subscription[]>();
  const dedupCache = new Map<string, number>();
  const DEDUP_MS = 50; // Low for position events

  function on<K extends keyof E>(event: K, handler: Handler<E[K]['payload']>, once = false) {
    if (!handlers.has(event as string)) handlers.set(event as string, []);
    const subs = handlers.get(event as string)!;
    subs.push({ handler: handler as Handler, once });
    return () => {
      const idx = subs.findIndex(s => s.handler === handler);
      if (idx >= 0) subs.splice(idx, 1);
    };
  }

  function once<K extends keyof E>(event: K, handler: Handler<E[K]['payload']>) {
    return on(event, handler, true);
  }

  function emit<K extends keyof E>(event: K, payload: E[K]['payload']) {
    // Skip dedup for high-frequency events (player:position)
    const skipDedup = event === 'player:position';

    if (!skipDedup) {
      const key = `${String(event)}:${JSON.stringify(payload)}`;
      const now = Date.now();
      const lastEmit = dedupCache.get(key);
      if (lastEmit && now - lastEmit < DEDUP_MS) return;
      dedupCache.set(key, now);

      // Cleanup old dedup entries
      if (dedupCache.size > 64) {
        const cutoff = now - 2000;
        for (const [k, t] of dedupCache) {
          if (t < cutoff) dedupCache.delete(k);
        }
      }
    }

    const subs = handlers.get(event as string);
    if (!subs) return;
    const toRemove: number[] = [];
    for (let i = 0; i < subs.length; i++) {
      subs[i].handler(payload);
      if (subs[i].once) toRemove.push(i);
    }
    for (let i = toRemove.length - 1; i >= 0; i--) {
      subs.splice(toRemove[i], 1);
    }
  }

  function clear() {
    handlers.clear();
    dedupCache.clear();
  }

  return { on, once, emit, clear };
}

export type GameEventBus = ReturnType<typeof createEventBus<GameEventMap>>;
export const bus = createEventBus<GameEventMap>();
