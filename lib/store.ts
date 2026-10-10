// Supabase REST store — no SDK, plain fetch.
// Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
// RLS must be disabled (or policies set to allow all) on tiktok_projects and tiktok_clips.

import type { Clip, Project } from "./types";

const BASE = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_ANON_KEY!;

function headers(extra?: Record<string, string>) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProject(row: any): Project {
  return {
    id: row.id,
    title: row.title,
    aspect: "9:16",
    fps: 30,
    width: 1080,
    height: 1920,
    durationMs: row.duration_ms ?? 0,
    status: row.status ?? "draft",
    aiDisclosure: row.ai_disclosure ?? false,
    hashtags: row.hashtags ?? [],
    clips: [],
    voiceoverScript: row.voiceover_script ?? "",
    voiceoverUrl: row.voiceover_url ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToClip(row: any): Clip {
  return {
    id: row.id,
    projectId: row.project_id,
    order: row.order,
    durationMs: row.duration_ms,
    trimStartMs: row.trim_start_ms ?? 0,
    pexelsVideoId: row.pexels_video_id,
    pexelsUrl: row.pexels_url,
    pexelsThumbnail: row.pexels_thumbnail,
    pexelsAuthor: row.pexels_author ?? "",
    pexelsWidth: row.pexels_width ?? 0,
    pexelsHeight: row.pexels_height ?? 0,
  };
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(
    `${BASE}/rest/v1/tiktok_projects?select=*&order=updated_at.desc`,
    { headers: headers() },
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const res = await fetch(
    `${BASE}/rest/v1/tiktok_projects?id=eq.${id}&select=*`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length) return null;
  const project = rowToProject(rows[0]);

  const clipRes = await fetch(
    `${BASE}/rest/v1/tiktok_clips?project_id=eq.${id}&order=order.asc&select=*`,
    { headers: headers() },
  );
  if (clipRes.ok) {
    const clipRows = await clipRes.json();
    project.clips = clipRows.map(rowToClip);
  }
  return project;
}

export async function createProject(title: string): Promise<Project> {
  const now = new Date().toISOString();
  const body = {
    title: title.trim() || "Untitled video",
    status: "draft",
    ai_disclosure: false,
    hashtags: [],
    duration_ms: 0,
    voiceover_script: "",
    voiceover_url: "",
    created_at: now,
    updated_at: now,
  };
  const res = await fetch(`${BASE}/rest/v1/tiktok_projects`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  const rows = await res.json();
  return rowToProject(Array.isArray(rows) ? rows[0] : rows);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "aiDisclosure" | "hashtags" | "durationMs" | "voiceoverScript" | "voiceoverUrl">>,
): Promise<Project | null> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.title === "string") body.title = patch.title.trim() || "Untitled video";
  if (typeof patch.aiDisclosure === "boolean") body.ai_disclosure = patch.aiDisclosure;
  if (Array.isArray(patch.hashtags)) body.hashtags = patch.hashtags;
  if (typeof patch.durationMs === "number") body.duration_ms = patch.durationMs;
  if (typeof patch.voiceoverScript === "string") body.voiceover_script = patch.voiceoverScript;
  if (typeof patch.voiceoverUrl === "string") body.voiceover_url = patch.voiceoverUrl;

  const res = await fetch(`${BASE}/rest/v1/tiktok_projects?id=eq.${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rowToProject(Array.isArray(rows) ? rows[0] : rows);
}

export async function deleteProject(id: string): Promise<boolean> {
  const res = await fetch(`${BASE}/rest/v1/tiktok_projects?id=eq.${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  return res.ok;
}

export async function addClip(
  projectId: string,
  clip: Omit<Clip, "id" | "projectId" | "order">,
): Promise<Clip> {
  const ordRes = await fetch(
    `${BASE}/rest/v1/tiktok_clips?project_id=eq.${projectId}&select=order&order=order.desc&limit=1`,
    { headers: headers() },
  );
  const ordRows = ordRes.ok ? await ordRes.json() : [];
  const nextOrder = ordRows.length ? ordRows[0].order + 1 : 0;

  const body = {
    project_id: projectId,
    order: nextOrder,
    duration_ms: clip.durationMs,
    trim_start_ms: clip.trimStartMs ?? 0,
    pexels_video_id: clip.pexelsVideoId,
    pexels_url: clip.pexelsUrl,
    pexels_thumbnail: clip.pexelsThumbnail,
    pexels_author: clip.pexelsAuthor ?? "",
    pexels_width: clip.pexelsWidth ?? 0,
    pexels_height: clip.pexelsHeight ?? 0,
  };
  const res = await fetch(`${BASE}/rest/v1/tiktok_clips`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase clip insert error: ${await res.text()}`);
  const rows = await res.json();
  return rowToClip(Array.isArray(rows) ? rows[0] : rows);
}

export async function removeClip(clipId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/rest/v1/tiktok_clips?id=eq.${clipId}`, {
    method: "DELETE",
    headers: headers(),
  });
  return res.ok;
}

export async function reorderClips(
  projectId: string,
  orderedIds: string[],
): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      fetch(`${BASE}/rest/v1/tiktok_clips?id=eq.${id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ order: i }),
      }),
    ),
  );
}

export async function trimClip(
  clipId: string,
  trimStartMs: number,
  durationMs: number,
): Promise<Clip | null> {
  const res = await fetch(`${BASE}/rest/v1/tiktok_clips?id=eq.${clipId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ trim_start_ms: trimStartMs, duration_ms: durationMs }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rowToClip(Array.isArray(rows) ? rows[0] : rows);
}
