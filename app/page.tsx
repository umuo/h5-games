import { games } from "@web-games/game-catalog";
import { GameLibrary } from "./GameLibrary";

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#games" aria-label="游点意思游戏列表">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>游点意思</span>
        </a>
        <nav aria-label="主导航">
          <a href="#games" aria-current="page">游戏列表</a>
        </nav>
        <span className="header-count">{String(games.length).padStart(2, "0")} GAMES</span>
      </header>

      <section className="games-section" id="games">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> NOW PLAYING</p>
            <h2>今天，玩点什么？</h2>
          </div>
          <p>{String(games.length).padStart(2, "0")} 款游戏已接入</p>
        </div>

        <GameLibrary games={games} />
      </section>

      <footer>
        <a className="brand" href="#games"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>游点意思</span></a>
        <p>为下一次无聊，提前做点准备。</p>
        <span>WEB GAMES LAB © 2026</span>
      </footer>
    </main>
  );
}
