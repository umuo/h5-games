"use client";

import type { GameCatalogItem } from "@web-games/game-catalog";
import { useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 8;

const fixedCategories = [
  { id: "all", label: "全部", mark: "ALL" },
  { id: "休闲", label: "休闲", mark: "01" },
  { id: "反应力", label: "反应", mark: "02" },
  { id: "益智", label: "益智", mark: "03" },
  { id: "动作", label: "动作", mark: "04" },
  { id: "街机", label: "街机", mark: "05" },
] as const;

export function GameLibrary({ games }: { games: GameCatalogItem[] }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const filteredGames = useMemo(
    () => activeCategory === "all" ? games : games.filter((game) => game.category === activeCategory),
    [activeCategory, games],
  );
  const visibleGames = filteredGames.slice(0, visibleCount);
  const hasMore = visibleCount < filteredGames.length;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, filteredGames.length));
        }
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredGames.length, hasMore]);

  return (
    <div className="library-shell">
      <div className="category-dock" aria-label="游戏分类">
        <div className="category-scroll">
          {fixedCategories.map((category) => {
            const count = category.id === "all"
              ? games.length
              : games.filter((game) => game.category === category.id).length;
            const selected = activeCategory === category.id;
            return (
              <button
                className={selected ? "category-button is-active" : "category-button"}
                type="button"
                aria-pressed={selected}
                key={category.id}
                onClick={() => {
                  setActiveCategory(category.id);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                <span className="category-mark">{category.mark}</span>
                <span>{category.label}</span>
                <small>{String(count).padStart(2, "0")}</small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="list-caption">
        <p><span /> {fixedCategories.find((category) => category.id === activeCategory)?.label ?? "全部"}游戏</p>
        <span>{String(filteredGames.length).padStart(2, "0")} GAMES</span>
      </div>

      {visibleGames.length > 0 ? (
        <ol className="game-list">
          {visibleGames.map((game, index) => (
            <li key={game.id}>
              <a className="game-row" href={game.path} aria-label={`开始${game.title}`}>
                <span className={`game-icon icon-tone-${(index % 4) + 1}`} aria-hidden="true">
                  <i className="game-icon-orbit" />
                  <b>{game.shortTitle.slice(0, 1)}</b>
                </span>
                <span className="game-row-copy">
                  <strong>{game.title}</strong>
                  <small>{game.description}</small>
                </span>
                <span className="game-row-meta">
                  <small>{game.category}</small>
                  <small>
                    {game.launchMode === "iframe"
                      ? "嵌入"
                      : game.orientation === "portrait"
                        ? "竖屏"
                        : game.orientation === "landscape"
                          ? "横屏"
                          : "自适应"}
                  </small>
                </span>
                <span className="play-button" aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-list">
          <span>+</span>
          <div><strong>这个分类还空着</strong><p>下一款游戏，可以从这里开始。</p></div>
        </div>
      )}

      <div className="load-sentinel" ref={loadMoreRef} aria-live="polite">
        {hasMore ? <><i /><span>上滑加载更多</span></> : filteredGames.length > 0 ? <span>已经看到全部游戏</span> : null}
      </div>
    </div>
  );
}
