export type GameToPlatformEvent =
  | { type: "READY"; gameId: string; version: string }
  | { type: "START"; gameId: string }
  | { type: "SCORE"; gameId: string; score: number }
  | { type: "GAME_OVER"; gameId: string; score: number }
  | { type: "EXIT"; gameId: string }
  | { type: "ERROR"; gameId: string; message: string };

export type PlatformToGameEvent =
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "RESTART" };

interface GameBridgeOptions {
  gameId: string;
  version: string;
  onCommand?: (event: PlatformToGameEvent) => void;
}

type WithoutGameId<T> = T extends unknown ? Omit<T, "gameId"> : never;

export function createGameBridge(options: GameBridgeOptions) {
  const emit = (event: WithoutGameId<GameToPlatformEvent>) => {
    const message = { ...event, gameId: options.gameId } as GameToPlatformEvent;
    if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
    window.dispatchEvent(new CustomEvent("web-game:event", { detail: message }));
  };

  const onMessage = (message: MessageEvent<PlatformToGameEvent>) => {
    if (message.origin !== window.location.origin) return;
    options.onCommand?.(message.data);
  };

  window.addEventListener("message", onMessage);

  return {
    ready: () => emit({ type: "READY", version: options.version }),
    started: () => emit({ type: "START" }),
    score: (score: number) => emit({ type: "SCORE", score }),
    gameOver: (score: number) => emit({ type: "GAME_OVER", score }),
    exit: () => emit({ type: "EXIT" }),
    destroy: () => window.removeEventListener("message", onMessage),
  };
}

export function createGameStorage<T>(gameId: string, defaults: T) {
  const key = `web-games:${gameId}:save`;
  return {
    load(): T {
      try {
        const value = window.localStorage.getItem(key);
        return value ? { ...defaults, ...JSON.parse(value) } : defaults;
      } catch {
        return defaults;
      }
    },
    save(value: T) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
    },
  };
}
