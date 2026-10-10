// Local JSON store for v1. Lives in data/projects.json.
// Replace with Supabase once the project exists (see design.md).
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Project } from "./types";

const FILE = path.join(process.cwd(), "data", "projects.json");

async function readAll(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

async function writeAll(projects: Project[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(projects, null, 2), "utf8");
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
