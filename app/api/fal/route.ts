import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";

// Kling 2.5 Turbo Pro: portrait 9:16, 5 or 10 seconds.
// Price on fal: $0.35 for 5 s, $0.07 per extra second.
const MODEL = process.env.FAL_VIDEO_MODEL ?? "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";

function costCents(durationS: 5 | 10) {
  return durationS === 10 ? 70 : 35;
}

function falHeaders() {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  };
}

/** Only ever call fal's own queue host, never a URL the browser made up. */
function safeQueueUrl(u: string | null) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "queue.fal.run" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Submit a generation job (after the user approved the cost).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    prompt?: string;
    duration?: number;
  };
  const prompt = body.prompt?.trim();
  if (!prompt || !body.projectId) {
    return NextResponse.json({ error: "prompt and projectId are required" }, { status: 400 });
  }
  const duration: 5 | 10 = body.duration === 10 ? 10 : 5;
  const cost = costCents(duration);

  const project = await getProject(body.projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.spentCents + cost > project.budgetCents) {
    return NextResponse.json({ error: "Over budget for this project" }, { status: 402 });
  }

  const res = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({
      prompt,
      duration: String(duration),
      aspect_ratio: "9:16",
      negative_prompt: "blur, distort, low quality, text, watermark",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("fal submit error", res.status, detail);
    return NextResponse.json({ error: "fal error", detail }, { status: res.status });
  }
  const job = (await res.json()) as { request_id: string; status_url: string; response_url: string };

  const updated = await updateProject(project.id, { spentCents: project.spentCents + cost });

  return NextResponse.json({
    requestId: job.request_id,
    statusUrl: job.status_url,
    responseUrl: job.response_url,
    costCents: cost,
    durationMs: duration * 1000,
    spentCents: updated?.spentCents ?? project.spentCents + cost,
  });
}

// Poll a job: returns { status } and, once finished, { videoUrl }.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusUrl = safeQueueUrl(searchParams.get("statusUrl"));
  const responseUrl = safeQueueUrl(searchParams.get("responseUrl"));
  if (!statusUrl || !responseUrl) {
    return NextResponse.json({ error: "Bad job URLs" }, { status: 400 });
  }

  const s = await fetch(statusUrl, { headers: falHeaders(), cache: "no-store" });
  if (!s.ok) {
    const detail = await s.text().catch(() => "");
    return NextResponse.json({ status: "ERROR", detail }, { status: 200 });
  }
  const st = (await s.json()) as { status: string; queue_position?: number };
  if (st.status !== "COMPLETED") {
    return NextResponse.json({ status: st.status, queuePosition: st.queue_position ?? null });
  }

  const r = await fetch(responseUrl, { headers: falHeaders(), cache: "no-store" });
  const out = (await r.json().catch(() => ({}))) as { video?: { url?: string }; detail?: unknown };
  if (!r.ok || !out.video?.url) {
    return NextResponse.json({ status: "ERROR", detail: out.detail ?? "No video in result" });
  }
  return NextResponse.json({ status: "COMPLETED", videoUrl: out.video.url });
}
