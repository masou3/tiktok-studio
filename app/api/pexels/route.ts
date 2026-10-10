import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") ?? "nature";
  const per_page = searchParams.get("per_page") ?? "20";

  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${per_page}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY! } },
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Pexels error" }, { status: res.status });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videos = (data.videos ?? []).map((v: any) => {
    const files: { quality: string; width: number; height: number; link: string; file_type: string }[] =
      v.video_files ?? [];
    const portrait = files.find((f) => f.quality === "hd" && f.height > f.width)
      ?? files.find((f) => f.height > f.width)
      ?? files[0];

    return {
      id: v.id,
      url: portrait?.link ?? "",
      width: v.width,
      height: v.height,
      durationMs: Math.round(v.duration * 1000),
      thumbnail: v.image ?? "",
      author: v.user?.name ?? "",
    };
  });

  return NextResponse.json(videos);
}
