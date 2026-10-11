import { NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  updateProject,
  addClip,
  removeClip,
  reorderClips,
  trimClip,
  updateClip,
  splitClip,
  duplicateClip,
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

  if (body.action === "splitClip") {
    const ok = await splitClip(id, body.clipId as string, Number(body.atMs));
    if (!ok) return NextResponse.json({ error: "Can't split there" }, { status: 400 });
    return NextResponse.json(await getProject(id));
  }
  if (body.action === "duplicateClip") {
    const ok = await duplicateClip(id, body.clipId as string);
    if (!ok) return NextResponse.json({ error: "Duplicate failed" }, { status: 400 });
    return NextResponse.json(await getProject(id));
  }

  if (body.action === "updateClip") {
    const clip = await updateClip(body.clipId as string, body.fields ?? {});
    if (!clip) return NextResponse.json({ error: "Update failed" }, { status: 400 });
    return NextResponse.json(clip);
  }

  const project = await updateProject(id, {
    ...(typeof body.title === "string" ? { title: body.title.trim() || "Untitled video" } : {}),
    ...(typeof body.aiDisclosure === "boolean" ? { aiDisclosure: body.aiDisclosure } : {}),
    ...(Array.isArray(body.hashtags) ? { hashtags: body.hashtags.map(String) } : {}),
    ...(typeof body.voiceoverScript === "string" ? { voiceoverScript: body.voiceoverScript } : {}),
    ...(typeof body.voiceoverUrl === "string" ? { voiceoverUrl: body.voiceoverUrl } : {}),
    ...(typeof body.musicUrl === "string" ? { musicUrl: body.musicUrl } : {}),
    ...(typeof body.musicName === "string" ? { musicName: body.musicName } : {}),
    ...(typeof body.musicVolume === "number" ? { musicVolume: body.musicVolume } : {}),
    ...(Array.isArray(body.captions) ? { captions: body.captions } : {}),
    ...(["bold", "box", "karaoke"].includes(body.captionStyle) ? { captionStyle: body.captionStyle } : {}),
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
