import { NextResponse } from "next/server";
import { listLibrary, removeFromLibrary } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listLibrary(), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const ok = await removeFromLibrary(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
}
