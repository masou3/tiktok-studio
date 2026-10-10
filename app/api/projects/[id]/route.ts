import { NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  updateProject,
  addClip,
  removeClip,
  reorderClips,
  trimClip,
} from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await req.json().catch(() => ({}))) as any;

  if (body.action === "addClip") {
    const clip = await addClip(id, body.clip);
    return NextResponse.json(clip, { status: 201 });
  }
  if (body.action === "removeClip") {
    await removeClip(body.clipId as string);
    const project = await getProject(id);
    return NextResponse.json(project);
  }
  if (body.action === "reorderClips") {
    await reorderClips(id, body.orderedIds as string[]);
    const project = await getProject(id);
    return NextResponse.json(project);
  }
  if (body.action === "trimClip") {
    const clip = await trimClip(body.clipId, body.trimStartMs, body.durationMs);
    return NextResponse.json(clip);
  }

  const project = await updateProject(id, {
    ...(typeof body.title === "string" ? { title: body.title.trim() || "Untitled video" } : {}),
    ...(typeof body.aiDisclosure === "boolean" ? { aiDisclosure: body.aiDisclosure } : {}),
    ...(Array.isArray(body.hashtags) ? { hashtags: body.hashtags.map(String) } : {}),
    ...(typeof body.voiceoverScript === "string" ? { voiceoverScript: body.voiceoverScript } : {}),
    ...(typeof body.voiceoverUrl === "string" ? { voiceoverUrl: body.voiceoverUrl } : {}),
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await deleteProject(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
