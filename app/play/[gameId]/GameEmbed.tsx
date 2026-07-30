"use client";

import type { IframeGameCatalogItem } from "@web-games/game-catalog";
import Link from "next/link";
import { useEffect, useState } from "react";

export function GameEmbed({ game }: { game: IframeGameCatalogItem }) {
  const [loaded, setLoaded] = useState(false);
  const [takingLonger, setTakingLonger] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const sourceHost = new URL(game.embedUrl).hostname;

  useEffect(() => {
    if (loaded) return;
    const timeout = window.setTimeout(() => setTakingLonger(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [loaded, frameKey]);

  const reloadGame = () => {
    setLoaded(false);
    setTakingLonger(false);
    setFrameKey((key) => key + 1);
  };

  return (
    <main className="embed-page">
      <header className="embed-header">
        <Link className="embed-back" href="/" aria-label="返回游戏列表">←</Link>
        <div className="embed-title">
          <strong>{game.title}</strong>
          <span>{sourceHost} · 安全嵌入</span>
        </div>
        <div className="embed-actions">
          <button className="embed-reload" type="button" onClick={reloadGame} aria-label={`重新加载${game.title}`}>
            ↻
          </button>
          <a
            className="embed-external"
            href={game.embedUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`在新窗口打开${game.title}`}
          >
            新窗口 ↗
          </a>
        </div>
      </header>

      <section className="embed-stage" aria-label={`${game.title}游戏区域`}>
        {!loaded && (
          <div className="embed-loading" role="status">
            <i aria-hidden="true" />
            <strong>{takingLonger ? "游戏加载得有点久…" : "正在加载游戏"}</strong>
            <span>{takingLonger ? "可以重新加载，或在新窗口打开" : `${game.shortTitle} · LOADING`}</span>
            {takingLonger && (
              <button type="button" onClick={reloadGame}>重新加载 ↻</button>
            )}
          </div>
        )}
        <iframe
          key={frameKey}
          className={loaded ? "embed-frame is-loaded" : "embed-frame"}
          src={game.embedUrl}
          title={game.title}
          allow="autoplay; fullscreen; gamepad"
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          onError={() => setTakingLonger(true)}
        />
      </section>
    </main>
  );
}
