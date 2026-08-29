export { createAudioKit } from "./audio";
export type { AudioKit } from "./audio";

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

interface CameraLike {
  setZoom(value: number): CameraLike;
  setScroll(x: number, y: number): unknown;
}

interface DisplayListLike {
  list: unknown[];
}

interface ResolutionAware {
  setResolution?: (value: number) => unknown;
  list?: unknown[];
}

interface LifecycleEventEmitter {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

interface LifecycleScene {
  game: {
    events: LifecycleEventEmitter;
    loop: {
      focus(): unknown;
      resume(): unknown;
    };
  };
  input: {
    enabled: boolean;
    resetPointers(): void;
  };
  scene: {
    isPaused(): boolean;
    pause(): unknown;
    resume(): unknown;
  };
  events: {
    once(event: string, listener: () => void): unknown;
  };
}

interface GameLifecycleOptions {
  onInterrupt?: () => void;
}

/**
 * Keeps Phaser input healthy across mobile lock-screen, app switching and
 * back-forward-cache restores. Scene suspension is tracked here so a visibility
 * or pageshow recovery can safely resume only pauses created by this helper.
 */
export function bindGameLifecycle(
  scene: LifecycleScene,
  options: GameLifecycleOptions = {},
) {
  let destroyed = false;
  let pausedByLifecycle = false;

  const resetInput = () => {
    if (destroyed) return;
    options.onInterrupt?.();
    scene.input.resetPointers();
  };
  const suspend = () => {
    resetInput();
    if (!scene.scene.isPaused()) {
      pausedByLifecycle = true;
      scene.scene.pause();
    }
  };
  const recover = () => {
    if (destroyed || document.hidden) return;
    scene.game.loop.focus();
    scene.game.loop.resume();
    if (pausedByLifecycle && scene.scene.isPaused()) scene.scene.resume();
    pausedByLifecycle = false;
    scene.input.enabled = true;
    resetInput();
  };
  const visibilityChanged = () => {
    if (document.hidden) suspend();
    else recover();
  };

  scene.game.events.on("blur", suspend);
  scene.game.events.on("hidden", suspend);
  scene.game.events.on("focus", recover);
  scene.game.events.on("visible", recover);
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("pageshow", recover);
  window.addEventListener("pointercancel", resetInput);
  window.addEventListener("touchcancel", resetInput);

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    scene.game.events.off("blur", suspend);
    scene.game.events.off("hidden", suspend);
    scene.game.events.off("focus", recover);
    scene.game.events.off("visible", recover);
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("pageshow", recover);
    window.removeEventListener("pointercancel", resetInput);
    window.removeEventListener("touchcancel", resetInput);
  };

  scene.events.once("shutdown", cleanup);
  return cleanup;
}

export function getGameRenderDpr(maxDpr = 2) {
  if (typeof window === "undefined") return 1;
  const deviceDpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  return Math.max(1, Math.min(deviceDpr, maxDpr));
}

export function configureHiDpiCamera(
  camera: CameraLike,
  logicalWidth: number,
  logicalHeight: number,
  renderDpr = getGameRenderDpr(),
) {
  camera
    .setZoom(renderDpr)
    .setScroll(
      -logicalWidth * (renderDpr - 1) / 2,
      -logicalHeight * (renderDpr - 1) / 2,
    );
}

export function sharpenSceneText(
  displayList: DisplayListLike,
  renderDpr = getGameRenderDpr(),
) {
  const pending = [...displayList.list];
  const visited = new Set<unknown>();

  while (pending.length > 0) {
    const child = pending.pop();
    if (!child || typeof child !== "object" || visited.has(child)) continue;
    visited.add(child);

    const resolutionAware = child as ResolutionAware;
    resolutionAware.setResolution?.(renderDpr);
    if (Array.isArray(resolutionAware.list)) pending.push(...resolutionAware.list);
  }
}
