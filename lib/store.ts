// Local JSON store for v1. Lives in data/projects.json.
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Project, Clip } from "./types";

const FILE = path.join(process.cwd(), "data", "projects.json");

async function readAll(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const projects = JSON.parse(raw) as Project[];
    // Backfill clips array for old records
    return projects.map((p) => ({ ...p, clips: p.clips ?? [] }));
  } catch {
    return [];
  }
}

async function writeAll(projects: Project[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(projects, null, 2), "utf8");
}

function calcDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + c.durationMs, 0);
}

export async function listProjects(): Promise<Project[]> {
  const all = await readAll();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<Project | null> {
  return (await readAll()).find((p) => p.id === id) ?? null;
}

export async function createProject(title: string): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    title: title.trim() || "Untitled video",
    aspect: "9:16",
    fps: 30,
    width: 1080,
    height: 1920,
    durationMs: 0,
    status: "draft",
    aiDisclosure: false,
    hashtags: [],
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
  const all = await readAll();
  all.push(project);
  await writeAll(all);
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "aiDisclosure" | "hashtags">>,
): Promise<Project | null> {
  const all = await readAll();
  const i = all.findIndex((p) => p.id === id);
  if (i === -1) return null;
  all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
  await writeAll(all);
  return all[i];
}

export async function deleteProject(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

// --- Clip operations ---

export async function addClip(
  projectId: string,
  clip: Omit<Clip, "id" | "projectId" | "order">,
): Promise<Project | null> {
  const all = await readAll();
  const i = all.findIndex((p) => p.id === projectId);
  if (i === -1) return null;
  const newClip: Clip = {
    ...clip,
    id: randomUUID(),
    projectId,
    order: all[i].clips.length,
  };
  all[i].clips.push(newClip);
  all[i].durationMs = calcDuration(all[i].clips);
  all[i].updatedAt = new Date().toISOString();
  await writeAll(all);
  return all[i];
}

export async function removeClip(
  projectId: string,
  clipId: string,
): Promise<Project | null> {
  const all = await readAll();
  const i = all.findIndex((p) => p.id === projectId);
  if (i === -1) return null;
  all[i].clips = all[i].clips
    .filter((c) => c.id !== clipId)
    .map((c, idx) => ({ ...c, order: idx }));
  all[i].durationMs = calcDuration(all[i].clips);
  all[i].updatedAt = new Date().toISOString();
  await writeAll(all);
  return all[i];
}

export async function reorderClips(
  projectId: string,
  orderedIds: string[],
): Promise<Project | null> {
  const all = await readAll();
  const i = all.findIndex((p) => p.id === projectId);
  if (i === -1) return null;
  const map = new Map(all[i].clips.map((c) => [c.id, c]));
  all[i].clips = orderedIds
    .filter((id) => map.has(id))
    .map((id, idx) => ({ ...map.get(id)!, order: idx }));
  all[i].updatedAt = new Date().toISOString();
  await writeAll(all);
  return all[i];
}

export async function trimClip(
  projectId: string,
  clipId: string,
  patch: Partial<Pick<Clip, "durationMs" | "trimStartMs">>,
): Promise<Project | null> {
  const all = await readAll();
  const i = all.findIndex((p) => p.id === projectId);
  if (i === -1) return null;
  const ci = all[i].clips.findIndex((c) => c.id === clipId);
  if (ci === -1) return null;
  all[i].clips[ci] = { ...all[i].clips[ci], ...patch };
  all[i].durationMs = calcDuration(all[i].clips);
  all[i].updatedAt = new Date().toISOString();
  await writeAll(all);
  return all[i];
}
