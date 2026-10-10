// Uses Web Crypto so it runs in both the Edge middleware and Node route handlers.
export const COOKIE = "ts_session";

const enc = new TextEncoder();

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-only-secret-change-me";
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

// Constant-time string comparison.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(): Promise<string> {
  // Single-user app: the token only proves the password was entered once.
  const payload = "owner";
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return safeEqual(token, await signSession());
}

export function checkPassword(input: string): boolean {
  const pw = process.env.APP_PASSWORD ?? "";
  if (!pw) return false;
  return safeEqual(input, pw);
}
