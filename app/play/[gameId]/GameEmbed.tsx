"use client";

import type { IframeGameCatalogItem } from "@web-games/game-catalog";
import Link from "next/link";
import { useEffect, useState } from "react";

export function GameEmbed({ game }: { game: IframeGameCatalogItem }) {
  const [loaded, setLoaded] = useState(false);
  const [takingLonger, setTakingLonger] = useState(false);

  useEffect(() => {
    if (loaded) return;
    const timeout = window.setTimeout(() => setTakingLonger(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [loaded]);

  return (
    <main className="embed-page">
      <header className="embed-header">
        <Link className="embed-back" href="/" aria-label="返回游戏列表">←</Link>
        <div className="embed-title">
          <strong>{game.title}</strong>
          <span>外部游戏 · 安全嵌入</span>
        </div>
        <a
          className="embed-external"
          href={game.embedUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`在新窗口打开${game.title}`}
        >
          新窗口 ↗
        </a>
      </header>

      <section className="embed-stage" aria-label={`${game.title}游戏区域`}>
        {!loaded && (
          <div className="embed-loading" role="status">
            <i aria-hidden="true" />
            <strong>{takingLonger ? "游戏加载得有点久…" : "正在加载游戏"}</strong>
            <span>{takingLonger ? "你也可以点击右上角在新窗口打开" : "CLOUD MATCH · LOADING"}</span>
          </div>
        )}
        <iframe
          className={loaded ? "embed-frame is-loaded" : "embed-frame"}
          src={game.embedUrl}
          title={game.title}
          allow="autoplay; fullscreen; gamepad"
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          onLoad={() => setLoaded(true)}
        />
      </section>
    </main>
  );
}
