import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: "游点意思 · 移动游戏实验场",
    description: "一个可以持续长出新游戏的移动端 Web 游戏实验场。",
    openGraph: {
      title: "游点意思 · 移动游戏实验场",
      description: "小屏幕，大乐趣。即点即玩的移动 Web 游戏实验场。",
      type: "website",
      images: [{ url: socialImage, width: 1731, height: 909, alt: "游点意思移动游戏实验场" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "游点意思 · 移动游戏实验场",
      description: "小屏幕，大乐趣。即点即玩的移动 Web 游戏实验场。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
