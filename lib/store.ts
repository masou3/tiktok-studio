// Supabase REST store — replaces the local JSON file store.
import type { Project, Clip } from "./types";

const BASE = process.env.SUPABASE_URL!;
const KEY  = process.env.SUPABASE_ANON_KEY!;

function headers() {
  return {
    "Content-Type": "application/json",
    "apikey": KEY,
    "Authorization": `Bearer ${KEY}`,
    "Prefer": "return=representation",
  };
}

async function q(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/rest/v1${path}`, { ...init, headers: { ...headers(), ...(init?.headers as object ?? {}) } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// Map DB row → Project
function rowToProject(row: DbProject, clips: Clip[] = []): Project {
  return {
    id: row.id,
    title: row.title,
    aspect: "9:16",
    fps: 30,
    width: 1080,
    height: 1920,
    durationMs: row.duration_ms,
    status: row.status as Project["status"],
    aiDisclosure: row.ai_disclosure,
    hashtags: row.hashtags ?? [],
    clips,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToClip(row: DbClip): Clip {
  return {
    id: row.id,
    projectId: row.project_id,
    order: row.order,
    durationMs: row.duration_ms,
    trimStartMs: row.trim_start_ms,
    pexelsVideoId: row.pexels_video_id,
    pexelsUrl: row.pexels_url,
    pexelsThumbnail: row.pexels_thumbnail,
    pexelsAuthor: row.pexels_author,
    pexelsWidth: row.pexels_width,
    pexelsHeight: row.pexels_height,
  };
}

async function getClipsForProject(projectId: string): Promise<Clip[]> {
  const rows: DbClip[] = await q(`/tiktok_clips?project_id=eq.${projectId}&order=order.asc`);
  return rows.map(rowToClip);
}

async function recalcDuration(projectId: string): Promise<number> {
  const clips = await getClipsForProject(projectId);
  return clips.reduce((s, c) => s + c.durationMs, 0);
}

async function touchProject(projectId: string, durationMs?: number) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (durationMs !== undefined) patch.duration_ms = durationMs;
  await q(`/tiktok_projects?id=eq.${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ---- Public API ----

export async function listProjects(): Promise<Project[]> {
  const rows: DbProject[] = await q("/tiktok_projects?order=updated_at.desc");
  const projects = await Promise.all(
    rows.map(async (row) => {
      const clips = await getClipsForProject(row.id);
      return rowToProject(row, clips);
    })
  );
  return projects;
}

export async function getProject(id: string): Promise<Project | null> {
  const rows: DbProject[] = await q(`/tiktok_projects?id=eq.${id}`);
  if (!rows.length) return null;
  const clips = await getClipsForProject(id);
  return rowToProject(rows[0], clips);
}

export async function createProject(title: string): Promise<Project> {
  const rows: DbProject[] = await q("/tiktok_projects", {
    method: "POST",
    body: JSON.stringify({ title: title.trim() || "Untitled video" }),
  });
  return rowToProject(rows[0], []);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "aiDisclosure" | "hashtags">>,
): Promise<Project | null> {
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.aiDisclosure !== undefined) dbPatch.ai_disclosure = patch.aiDisclosure;
  if (patch.hashtags !== undefined) dbPatch.hashtags = patch.hashtags;
  await q(`/tiktok_projects?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(dbPatch) });
  return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  await q(`/tiktok_projects?id=eq.${id}`, { method: "DELETE" });
  return true;
}

export async function addClip(
  projectId: string,
  clip: Omit<Clip, "id" | "projectId" | "order">,
): Promise<Project | null> {
  const existing = await getClipsForProject(projectId);
  const order = existing.length;
  await q("/tiktok_clips", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      order,
      duration_ms: clip.durationMs,
      trim_start_ms: clip.trimStartMs,
      pexels_video_id: clip.pexelsVideoId,
      pexels_url: clip.pexelsUrl,
      pexels_thumbnail: clip.pexelsThumbnail,
      pexels_author: clip.pexelsAuthor,
      pexels_width: clip.pexelsWidth,
      pexels_height: clip.pexelsHeight,
    }),
  });
  const dur = await recalcDuration(projectId);
  await touchProject(projectId, dur);
  return getProject(projectId);
}

export async function removeClip(projectId: string, clipId: string): Promise<Project | null> {
  await q(`/tiktok_clips?id=eq.${clipId}`, { method: "DELETE" });
  // Re-number remaining clips
  const remaining = await getClipsForProject(projectId);
  await Promise.all(
    remaining.map((c, idx) =>
      q(`/tiktok_clips?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ order: idx }) })
    )
  );
  const dur = await recalcDuration(projectId);
  await touchProject(projectId, dur);
  return getProject(projectId);
}

export async function reorderClips(projectId: string, orderedIds: string[]): Promise<Project | null> {
  await Promise.all(
    orderedIds.map((id, idx) =>
      q(`/tiktok_clips?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ order: idx }) })
    )
  );
  await touchProject(projectId);
  return getProject(projectId);
}

export async function trimClip(
  projectId: string,
  clipId: string,
  patch: Partial<Pick<Clip, "durationMs" | "trimStartMs">>,
): Promise<Project | null> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.durationMs !== undefined) dbPatch.duration_ms = patch.durationMs;
  if (patch.trimStartMs !== undefined) dbPatch.trim_start_ms = patch.trimStartMs;
  await q(`/tiktok_clips?id=eq.${clipId}`, { method: "PATCH", body: JSON.stringify(dbPatch) });
  const dur = await recalcDuration(projectId);
  await touchProject(projectId, dur);
  return getProject(projectId);
}

// ---- DB row types ----
type DbProject = {
  id: string; title: string; width: number; height: number;
  duration_ms: number; status: string; ai_disclosure: boolean;
  hashtags: string[]; created_at: string; updated_at: string;
};
type DbClip = {
  id: string; project_id: string; order: number;
  duration_ms: number; trim_start_ms: number;
  pexels_video_id: number; pexels_url: string; pexels_thumbnail: string;
  pexels_author: string; pexels_width: number; pexels_height: number;
};
