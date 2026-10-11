import { NextResponse } from "next/server";
import { createProject, duplicateProject, listProjects } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; duplicateOf?: string };
  if (body.duplicateOf) {
    const copy = await duplicateProject(body.duplicateOf);
    if (!copy) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(copy, { status: 201 });
  }
  const project = await createProject(body.title ?? "");
  return NextResponse.json(project, { status: 201 });
}
