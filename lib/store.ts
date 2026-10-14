// Supabase REST store — no SDK, plain fetch.
// Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
// RLS must be disabled (or policies set to allow all) on tiktok_projects and tiktok_clips.

import { cleanEffects, cleanLook } from "./types";
import type { Caption, CaptionStyle, Clip, LibraryClip, Project, ProjectCard, TransitionType } from "./types";

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
    captionStyle: row.caption_style ?? "tiktok",
    look: cleanLook(row.look),
    effects: cleanEffects(row.effects),
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
  patch: Partial<Pick<Project, "title" | "aiDisclosure" | "hashtags" | "durationMs" | "voiceoverScript" | "voiceoverUrl" | "captions" | "captionStyle" | "look" | "effects" | "spentCents" | "musicUrl" | "musicName" | "musicVolume" | "musicFadeMs">>,
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
  if (patch.look) body.look = cleanLook(patch.look);
  if (Array.isArray(patch.effects)) body.effects = cleanEffects(patch.effects);
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

const TRANSITION_IDS: TransitionType[] = ["cut", "crossfade", "slide", "zoom", "flash", "whip", "spin", "glitch", "slideL", "slideU", "slideD", "whipL", "whipU", "whipD", "burn"];

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


// ---------- home screen cards ----------

/** Light listing for the home screen: skips the voiceover audio and captions, which are large. */
export async function listProjectCards(): Promise<ProjectCard[]> {
  const [pr, cr] = await Promise.all([
    fetch(
      `${BASE}/rest/v1/tiktok_projects?select=id,title,updated_at,spent_cents,voiceover_script&order=updated_at.desc`,
      { headers: headers(), cache: "no-store" },
    ),
    fetch(
      `${BASE}/rest/v1/tiktok_clips?select=project_id,order,duration_ms,source,pexels_url,pexels_thumbnail&order=order.asc`,
      { headers: headers(), cache: "no-store" },
    ),
  ]);
  if (!pr.ok) return [];
  const projects = (await pr.json()) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const clips = cr.ok ? ((await cr.json()) as any[]) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const byProject = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const c of clips) {
    const list = byProject.get(c.project_id) ?? [];
    list.push(c);
    byProject.set(c.project_id, list);
  }
  return projects.map((p) => {
    const list = byProject.get(p.id) ?? [];
    const first = list[0];
    let thumb: ProjectCard["thumb"] = null;
    if (first) {
      if (first.source === "fal") thumb = { kind: "video", url: first.pexels_url };
      else if (first.source === "image") thumb = { kind: "image", url: first.pexels_url };
      else if (first.pexels_thumbnail) thumb = { kind: "image", url: first.pexels_thumbnail };
    }
    return {
      id: p.id,
      title: p.title,
      updatedAt: p.updated_at,
      spentCents: p.spent_cents ?? 0,
      clipCount: list.length,
      durationMs: list.reduce((a, c) => a + (c.duration_ms ?? 0), 0),
      hasVoice: !!(p.voiceover_script && String(p.voiceover_script).trim()),
      thumb,
    };
  });
}

/** Copy a project, its clips, voiceover, captions and music. AI spend starts again at zero. */
export async function duplicateProject(id: string): Promise<Project | null> {
  const src = await getProject(id);
  if (!src) return null;
  const now = new Date().toISOString();
  const res = await fetch(`${BASE}/rest/v1/tiktok_projects`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      title: `${src.title} (copy)`.slice(0, 120),
      status: "draft",
      ai_disclosure: src.aiDisclosure,
      hashtags: src.hashtags,
      duration_ms: src.durationMs,
      voiceover_script: src.voiceoverScript,
      voiceover_url: src.voiceoverUrl,
      music_url: src.musicUrl,
      music_name: src.musicName,
      music_volume: src.musicVolume,
      music_fade_ms: src.musicFadeMs,
      captions: src.captions,
      caption_style: src.captionStyle,
      look: src.look,
      effects: src.effects,
      budget_cents: src.budgetCents,
      spent_cents: 0,
      created_at: now,
      updated_at: now,
    }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const copy = rowToProject(Array.isArray(rows) ? rows[0] : rows);
  if (src.clips.length) {
    await fetch(`${BASE}/rest/v1/tiktok_clips`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(
        src.clips.map((c, i) => ({
          project_id: copy.id,
          order: i,
          duration_ms: c.durationMs,
          trim_start_ms: c.trimStartMs,
          source_duration_ms: c.sourceDurationMs,
          source: c.source,
          transition_in: c.transitionIn,
          transition_ms: c.transitionMs,
          pexels_video_id: c.pexelsVideoId,
          pexels_url: c.pexelsUrl,
          pexels_thumbnail: c.pexelsThumbnail,
          pexels_author: c.pexelsAuthor,
          pexels_width: c.pexelsWidth,
          pexels_height: c.pexelsHeight,
        })),
      ),
    });
  }
  return copy;
}

// ---------- saved AI clips ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLibrary(r: any): LibraryClip {
  return { id: r.id, url: r.url, label: r.label ?? "", durationMs: r.duration_ms ?? 5000, createdAt: r.created_at };
}

export async function listLibrary(): Promise<LibraryClip[]> {
  const res = await fetch(`${BASE}/rest/v1/tiktok_ai_library?select=*&order=created_at.desc&limit=200`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  return ((await res.json()) as unknown[]).map(rowToLibrary);
}

/** Remember an AI clip so it can be reused later, even after it's deleted from a project. */
export async function addToLibrary(url: string, label: string, durationMs: number): Promise<void> {
  if (!url) return;
  await fetch(`${BASE}/rest/v1/tiktok_ai_library?on_conflict=url`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({ url, label: label.slice(0, 200), duration_ms: Math.round(durationMs) || 5000 }),
  }).catch(() => null);
}

export async function removeFromLibrary(id: string): Promise<boolean> {
  const res = await fetch(`${BASE}/rest/v1/tiktok_ai_library?id=eq.${id}`, { method: "DELETE", headers: headers() });
  return res.ok;
}
