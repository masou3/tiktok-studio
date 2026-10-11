import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { getProject } from "@/lib/store";
import { buildAss, buildFilterGraph } from "@/lib/export";

export const runtime = "nodejs";
export const maxDuration = 300;

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  // ffmpeg-static puts the binary in its package folder. Resolve it by hand so
  // the bundler does not rewrite the path.
  return path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
}

async function download(url: string, file: string) {
  // Files shipped with the app (public/brand/...) are read from disk.
  if (url.startsWith("/") && !url.startsWith("//")) {
    const rel = path.normalize(url).replace(/^([/\\])+/, "");
    if (rel.startsWith("brand" + path.sep) && !rel.includes("..")) {
      await copyFile(path.join(process.cwd(), "public", rel), file);
      return;
    }
    throw new Error("Unknown local file");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download clip (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

function run(bin: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => {
      err = (err + d.toString()).slice(-4000);
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited ${code}`))));
  });
}

export async function POST(req: Request) {
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!project.clips.length) return NextResponse.json({ error: "Add at least one clip first" }, { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), "export-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    // 1. Source files
    const files = new Map<string, string>();
    const urls = [...new Set(project.clips.map((c) => c.pexelsUrl))];
    await Promise.all(
      urls.map(async (u, i) => {
        const f = path.join(dir, `src${i}${u.startsWith("/") ? path.extname(u) : ".mp4"}`);
        await download(u, f);
        files.set(u, f);
      }),
    );

    let audioFile = "";
    if (project.voiceoverUrl) {
      audioFile = path.join(dir, "voice.mp3");
      if (project.voiceoverUrl.startsWith("data:")) {
        const b64 = project.voiceoverUrl.slice(project.voiceoverUrl.indexOf(",") + 1);
        await writeFile(audioFile, Buffer.from(b64, "base64"));
      } else {
        await download(project.voiceoverUrl, audioFile);
      }
    }

    let musicFile = "";
    if (project.musicUrl) {
      musicFile = path.join(dir, "music.bin");
      await download(project.musicUrl, musicFile);
    }

    // 2. Captions + font
    const hasCaptions = project.captions.length > 0;
    if (hasCaptions) {
      await mkdir(path.join(dir, "fonts"));
      const fontDir = path.join(process.cwd(), "assets", "fonts");
      for (const f of await readdir(fontDir)) await copyFile(path.join(fontDir, f), path.join(dir, "fonts", f));
      await writeFile(path.join(dir, "captions.ass"), buildAss(project.captions, project.captionStyle));
    }

    // 3. Render
    const audioIndex = audioFile ? project.clips.length : -1;
    const musicIndex = musicFile ? project.clips.length + (audioFile ? 1 : 0) : -1;
    const { graph, totalMs } = buildFilterGraph(project, hasCaptions, audioIndex, musicIndex);
    await writeFile(path.join(dir, "graph.txt"), graph);
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    for (const c of project.clips) {
      if (c.source === "image") args.push("-loop", "1", "-framerate", "30", "-t", ((c.durationMs + 2000) / 1000).toFixed(3));
      args.push("-i", files.get(c.pexelsUrl)!);
    }
    if (audioFile) args.push("-i", audioFile);
    if (musicFile) args.push("-stream_loop", "-1", "-i", musicFile);
    args.push(
      "-filter_complex_script", "graph.txt",
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      "-t", (totalMs / 1000).toFixed(3),
      "out.mp4",
    );
    await run(ffmpegPath(), args, dir);

    // 4. Stream the file back, then clean up.
    const out = path.join(dir, "out.mp4");
    const size = (await stat(out)).size;
    const stream = createReadStream(out);
    stream.on("close", cleanup);
    const name = (project.title || "video").replace(/[^\w\- ]+/g, "").trim() || "video";
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${name}.mp4"`,
      },
    });
  } catch (e) {
    await cleanup();
    console.error("export error", e);
    return NextResponse.json({ error: "Export failed", detail: String((e as Error).message ?? e) }, { status: 500 });
  }
}
