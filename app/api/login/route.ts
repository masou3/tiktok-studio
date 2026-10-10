import { NextResponse } from "next/server";
import { COOKIE, checkPassword, signSession } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(COOKIE, await signSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
