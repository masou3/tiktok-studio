// Supabase REST store — no SDK, plain fetch.
// Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
// RLS must be disabled (or policies set to allow all) on tiktok_projects and tiktok_clips.

import type { Caption, CaptionStyle, Clip, Project, TransitionType } from "./types";

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
    musicUrl: row.music_url ?? "",
    musicName: row.music_name ?? "",
    musicVolume: row.music_volume ?? 25,
    musicFadeMs: row.music_fade_ms ?? 1500,
    captions: Array.isArray(row.captions) ? row.captions : [],
    captionStyle: row.caption_style ?? "bold",
    budgetCents: row.budget_cents ?? 500,
    spentCents: row.spent_cents ?? 0,
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
    sourceDurationMs: row.source_duration_ms ?? row.duration_ms,
    source: row.source ?? "pexels",
    transitionIn: row.transition_in ?? "cut",
    transitionMs: row.transition_ms ?? 400,
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
  patch: Partial<Pick<Project, "title" | "aiDisclosure" | "hashtags" | "durationMs" | "voiceoverScript" | "voiceoverUrl" | "captions" | "captionStyle" | "spentCents" | "musicUrl" | "musicName" | "musicVolume" | "musicFadeMs">>,
): Promise<Project | null> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.title === "string") body.title = patch.title.trim() || "Untitled video";
  if (typeof patch.aiDisclosure === "boolean") body.ai_disclosure = patch.aiDisclosure;
  if (Array.isArray(patch.hashtags)) body.hashtags = patch.hashtags;
  if (typeof patch.durationMs === "number") body.duration_ms = patch.durationMs;
  if (typeof patch.voiceoverScript === "string") body.voiceover_script = patch.voiceoverScript;
  if (typeof patch.voiceoverUrl === "string") body.voiceover_url = patch.voiceoverUrl;
  if (Array.isArray(patch.captions)) body.captions = patch.captions as Caption[];
  if (typeof patch.captionStyle === "string") body.caption_style = patch.captionStyle as CaptionStyle;
  if (typeof patch.spentCents === "number") body.spent_cents = patch.spentCents;
  if (typeof patch.musicUrl === "string") body.music_url = patch.musicUrl;
  if (typeof patch.musicFadeMs === "number") body.music_fade_ms = Math.min(5000, Math.max(0, Math.round(patch.musicFadeMs)));
  if (typeof patch.musicName === "string") body.music_name = patch.musicName;
  if (typeof patch.musicVolume === "number") body.music_volume = Math.min(100, Math.max(0, Math.round(patch.musicVolume)));

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
  clip: Omit<Clip, "id" | "projectId" | "order" | "transitionIn" | "transitionMs"> &
    Partial<Pick<Clip, "transitionIn" | "transitionMs">>,
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
    source_duration_ms: clip.sourceDurationMs ?? clip.durationMs,
    source: clip.source ?? "pexels",
    transition_in: clip.transitionIn ?? "cut",
    transition_ms: clip.transitionMs ?? 400,
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

const TRANSITION_IDS: TransitionType[] = ["cut", "crossfade", "slide", "zoom"];

export async function updateClip(
  clipId: string,
  fields: Partial<Pick<Clip, "trimStartMs" | "durationMs" | "transitionIn" | "transitionMs">>,
): Promise<Clip | null> {
  const body: Record<string, unknown> = {};
  if (typeof fields.trimStartMs === "number") body.trim_start_ms = Math.max(0, Math.round(fields.trimStartMs));
  if (typeof fields.durationMs === "number") body.duration_ms = Math.max(500, Math.round(fields.durationMs));
  if (fields.transitionIn && TRANSITION_IDS.includes(fields.transitionIn)) body.transition_in = fields.transitionIn;
  if (typeof fields.transitionMs === "number") body.transition_ms = Math.min(2000, Math.max(100, Math.round(fields.transitionMs)));
  if (!Object.keys(body).length) return null;
  const res = await fetch(`${BASE}/rest/v1/tiktok_clips?id=eq.${clipId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rowToClip(Array.isArray(rows) ? rows[0] : rows);
}

/** Insert a copy of a clip's source right after `afterClipId`, then renumber. */
async function insertAfter(
  projectId: string,
  afterClipId: string,
  clip: Parameters<typeof addClip>[1],
): Promise<Clip | null> {
  const created = await addClip(projectId, clip);
  const project = await getProject(projectId);
  if (!project) return null;
  const ids = project.clips.map((c) => c.id).filter((id) => id !== created.id);
  const at = ids.indexOf(afterClipId);
  ids.splice(at < 0 ? ids.length : at + 1, 0, created.id);
  await reorderClips(projectId, ids);
  return created;
}

function cloneFields(c: Clip): Parameters<typeof addClip>[1] {
  return {
    durationMs: c.durationMs,
    trimStartMs: c.trimStartMs,
    sourceDurationMs: c.sourceDurationMs,
    source: c.source,
    pexelsVideoId: c.pexelsVideoId,
    pexelsUrl: c.pexelsUrl,
    pexelsThumbnail: c.pexelsThumbnail,
    pexelsAuthor: c.pexelsAuthor,
    pexelsWidth: c.pexelsWidth,
    pexelsHeight: c.pexelsHeight,
    transitionIn: "cut",
  };
}

const MIN_CLIP_MS = 500;

/** Cut a clip in two at `atMs` (measured from the clip's own start). */
export async function splitClip(projectId: string, clipId: string, atMs: number): Promise<boolean> {
  const project = await getProject(projectId);
  const clip = project?.clips.find((c) => c.id === clipId);
  if (!clip) return false;
  const at = Math.round(atMs);
  if (at < MIN_CLIP_MS || clip.durationMs - at < MIN_CLIP_MS) return false;
  const second = {
    ...cloneFields(clip),
    trimStartMs: clip.trimStartMs + at,
    durationMs: clip.durationMs - at,
  };
  const first = await updateClip(clipId, { durationMs: at });
  if (!first) return false;
  const made = await insertAfter(projectId, clipId, second);
  return !!made;
}

export async function duplicateClip(projectId: string, clipId: string): Promise<boolean> {
  const project = await getProject(projectId);
  const clip = project?.clips.find((c) => c.id === clipId);
  if (!clip) return false;
  return !!(await insertAfter(projectId, clipId, cloneFields(clip)));
}
