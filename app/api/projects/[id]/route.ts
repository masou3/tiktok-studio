import { NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    aiDisclosure?: boolean;
    hashtags?: string[];
  };
  const project = await updateProject(id, {
    ...(typeof body.title === "string" ? { title: body.title.trim() || "Untitled video" } : {}),
    ...(typeof body.aiDisclosure === "boolean" ? { aiDisclosure: body.aiDisclosure } : {}),
    ...(Array.isArray(body.hashtags) ? { hashtags: body.hashtags.map(String) } : {}),
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
