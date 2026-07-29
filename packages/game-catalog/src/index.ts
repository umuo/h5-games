export type GameOrientation = "portrait" | "landscape" | "any";

interface GameCatalogBase {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  category: string;
  engine: string;
  orientation: GameOrientation;
  version: string;
  path: string;
  enabled?: boolean;
}

export interface StandaloneGameCatalogItem extends GameCatalogBase {
  launchMode?: "standalone";
  embedUrl?: never;
}

export interface IframeGameCatalogItem extends GameCatalogBase {
  launchMode: "iframe";
  embedUrl: string;
}

export type GameCatalogItem = StandaloneGameCatalogItem | IframeGameCatalogItem;

export { games } from "./generated";
