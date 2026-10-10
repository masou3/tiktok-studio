import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const page = req.nextUrl.searchParams.get("page") ?? "1";
  if (!query.trim()) return NextResponse.json({ videos: [] });

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No Pexels key" }, { status: 500 });

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=20&page=${page}&orientation=portrait&size=medium`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) return NextResponse.json({ error: "Pexels error" }, { status: res.status });

  const data = await res.json();

  // Normalise to what the UI needs
  const videos = (data.videos ?? []).map((v: PexelsVideo) => {
    // Prefer HD portrait file, fall back to SD
    const files: PexelsFile[] = v.video_files ?? [];
    const hd =
      files.find((f) => f.quality === "hd" && f.width < f.height) ??
      files.find((f) => f.width < f.height) ??
      files[0];
    return {
      id: v.id,
      url: hd?.link ?? "",
      width: hd?.width ?? v.width,
      height: hd?.height ?? v.height,
      durationMs: (v.duration ?? 0) * 1000,
      thumbnail: v.image,
      author: v.user?.name ?? "",
    };
  });

  return NextResponse.json({ videos, total: data.total_results ?? 0 });
}

type PexelsFile = { quality: string; link: string; width: number; height: number };
type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  duration: number;
  image: string;
  user: { name: string };
  video_files: PexelsFile[];
};
