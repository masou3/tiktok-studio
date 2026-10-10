import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const project = await createProject(body.title ?? "");
  return NextResponse.json(project, { status: 201 });
}
