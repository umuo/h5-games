import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { games } from "@web-games/game-catalog";
import { GameEmbed } from "./GameEmbed";

interface GamePageProps {
  params: Promise<{ gameId: string }>;
}

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { gameId } = await params;
  const game = games.find((item) => item.id === gameId && item.launchMode === "iframe");
  return {
    title: game ? `${game.title} · 游点意思` : "游戏不存在 · 游点意思",
    description: game?.description,
  };
}

export default async function EmbeddedGamePage({ params }: GamePageProps) {
  const { gameId } = await params;
  const game = games.find((item) => item.id === gameId && item.launchMode === "iframe");
  if (!game || game.launchMode !== "iframe") notFound();
  return <GameEmbed game={game} />;
}
