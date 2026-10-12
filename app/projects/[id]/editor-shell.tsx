"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Project, Clip, ChatMessage, Caption, CaptionStyle, TransitionType, CaptionWord, LibraryClip, Look, Effect, EffectType } from "@/lib/types";
import { TRANSITIONS, LOOK_PRESETS } from "@/lib/types";
import { EFFECTS as FX_LIST } from "@/lib/types";
import { layoutClips, clipsTotalMs, fmtTime, buildCaptions, captionAt, layerAt, wordsFromScript, effectState } from "@/lib/timeline";

type PexelsVideo = {
  id: number;
  url: string;
  width: number;
  height: number;
  durationMs: number;
  thumbnail: string;
  author: string;
};

type FalJob = {
  id: string;
  prompt: string;
  durationMs: number;
  costCents: number;
  statusUrl: string;
  responseUrl: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "ADDED" | "ERROR";
  queuePosition?: number | null;
  error?: string;
};

const DEFAULT_CLIP_MS = 5000;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const transitionShort: Record<TransitionType, string> = { cut: "+", crossfade: "Fade", slide: "Slide", zoom: "Zoom", flash: "Flash", whip: "Whip", spin: "Spin", glitch: "Glitch" };

function loadJobs(projectId: string): FalJob[] {
  try {
    const raw = window.localStorage.getItem(`falJobs:${projectId}`);
    return raw ? (JSON.parse(raw) as FalJob[]) : [];
  } catch {
    return [];
  }
}
function saveJobs(projectId: string, jobs: FalJob[]) {
  try {
    window.localStorage.setItem(`falJobs:${projectId}`, JSON.stringify(jobs.slice(-20)));
  } catch {
    // storage unavailable: jobs just won't survive a reload
  }
}

export default function EditorShell({ project: initial }: { project: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [title, setTitle] = useState(initial.title);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const router = useRouter();

  const [tab, setTab] = useState<"footage" | "claude">("footage");
  const [footageSource, setFootageSource] = useState<"pexels" | "fal" | "brand">("pexels");

  // Pexels
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState<PexelsVideo[]>([]);
  const [searching, setSearching] = useState(false);
  const [hoverVideo, setHoverVideo] = useState<PexelsVideo | null>(null);
  const hoverVideoRef = useRef<HTMLVideoElement>(null);

  // fal.ai
  const [falPrompt, setFalPrompt] = useState("");
  const [falSeconds, setFalSeconds] = useState<5 | 10>(5);
  const [approval, setApproval] = useState<{ prompt: string; seconds: 5 | 10; costCents: number } | null>(null);
  const [falJobs, setFalJobs] = useState<FalJob[]>([]);
  const [falError, setFalError] = useState("");

  // Selection
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [openJoin, setOpenJoin] = useState<string | null>(null);
  const dragClipId = useRef<string | null>(null);
  const dragTransition = useRef<TransitionType | null>(null);
  const dragEffect = useRef<EffectType | null>(null);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const fxRef = useRef<Effect[]>([]);

  // Claude + voiceover
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [voiceoverScript, setVoiceoverScript] = useState(initial.voiceoverScript ?? "");
  const [audioUrl, setAudioUrl] = useState(initial.voiceoverUrl ?? "");
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Playback
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const timeRef = useRef(0);
  const [audioMs, setAudioMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [musicInput, setMusicInput] = useState("");

  // Saved AI clips, undo history, and the two-step project delete
  const [library, setLibrary] = useState<LibraryClip[]>([]);
  const history = useRef<Clip[][]>([]);
  const lastSnap = useRef(0);
  const clipsNow = useRef<Clip[]>(initial.clips);
  const [canUndo, setCanUndo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const undoRef = useRef<() => void>(() => {});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const tracksRef = useRef<HTMLDivElement>(null);

  const placed = useMemo(() => layoutClips(project.clips), [project.clips]);
  const clipsMs = clipsTotalMs(project.clips);
  const totalMs = Math.max(clipsMs, audioUrl ? audioMs : 0);

  // The audio can finish loading before React attaches onLoadedMetadata (data URLs are fast),
  // so read the duration directly if it is already known.
  useEffect(() => {
    const el = audioRef.current;
    if (!audioUrl || !el) { setAudioMs(0); return; }
    const read = () => { if (isFinite(el.duration) && el.duration > 0) setAudioMs(Math.round(el.duration * 1000)); };
    read();
    el.addEventListener("loadedmetadata", read);
    el.addEventListener("durationchange", read);
    return () => { el.removeEventListener("loadedmetadata", read); el.removeEventListener("durationchange", read); };
  }, [audioUrl]);
  const pct = (ms: number) => (totalMs > 0 ? (ms / totalMs) * 100 : 0);

  // ---------- saving ----------
  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaveState("saving");
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = (await res.json()) as Project;
        // The metadata endpoint doesn't return clips; keep ours.
        setProject((p) => ({ ...p, ...updated, clips: p.clips }));
      }
      setSaveState("saved");
      return res;
    },
    [project.id],
  );

  const reloadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
    if (res.ok) setProject(await res.json());
  }, [project.id]);

  useEffect(() => {
    clipsNow.current = project.clips;
  }, [project.clips]);

  // Remember the clips as they are now, so Undo can put them back. Bursts of edits (a slider drag) share one snapshot.
  const pushHistory = useCallback((always = true) => {
    const now = Date.now();
    if (!always && now - lastSnap.current < 1200) return;
    lastSnap.current = now;
    history.current = [...history.current.slice(-29), JSON.parse(JSON.stringify(clipsNow.current))];
    setCanUndo(true);
  }, []);

  async function undo() {
    const snap = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!snap) return;
    setSaveState("saving");
    const api = (body: Record<string, unknown>) =>
      fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const cur = clipsNow.current;
    const snapIds = new Set(snap.map((c) => c.id));
    const curIds = new Set(cur.map((c) => c.id));
    for (const c of cur) if (!snapIds.has(c.id)) await api({ action: "removeClip", clipId: c.id });
    const idMap: Record<string, string> = {};
    for (const c of snap) {
      const now = cur.find((x) => x.id === c.id);
      if (now) {
        idMap[c.id] = c.id;
        if (now.durationMs !== c.durationMs || now.trimStartMs !== c.trimStartMs || now.transitionIn !== c.transitionIn || now.transitionMs !== c.transitionMs) {
          await api({ action: "updateClip", clipId: c.id, fields: { durationMs: c.durationMs, trimStartMs: c.trimStartMs, transitionIn: c.transitionIn, transitionMs: c.transitionMs } });
        }
      } else if (!curIds.has(c.id)) {
        const res = await api({
          action: "addClip",
          clip: {
            durationMs: c.durationMs, trimStartMs: c.trimStartMs, sourceDurationMs: c.sourceDurationMs, source: c.source,
            transitionIn: c.transitionIn, transitionMs: c.transitionMs, pexelsVideoId: c.pexelsVideoId, pexelsUrl: c.pexelsUrl,
            pexelsThumbnail: c.pexelsThumbnail, pexelsAuthor: c.pexelsAuthor, pexelsWidth: c.pexelsWidth, pexelsHeight: c.pexelsHeight,
          },
        });
        if (res.ok) idMap[c.id] = ((await res.json()) as Clip).id;
      }
    }
    await api({ action: "reorderClips", orderedIds: snap.map((c) => idMap[c.id]).filter(Boolean) });
    await reloadProject();
    setSelectedClipId(null);
    setSaveState("saved");
  }
  undoRef.current = undo;

  const loadLibrary = useCallback(async () => {
    const res = await fetch("/api/library", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setLibrary((await res.json()) as LibraryClip[]);
  }, []);

  async function removeFromLibrary(id: string) {
    setLibrary((l) => l.filter((x) => x.id !== id));
    await fetch(`/api/library?id=${id}`, { method: "DELETE" }).catch(() => null);
  }

  const pendingClipFields = useRef<Record<string, Partial<Clip>>>({});
  const clipTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function changeClip(id: string, fields: Partial<Clip>, delayMs = 500) {
    pushHistory(false);
    setProject((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...fields } : c)) }));
    pendingClipFields.current[id] = { ...pendingClipFields.current[id], ...fields };
    clearTimeout(clipTimers.current[id]);
    setSaveState("saving");
    clipTimers.current[id] = setTimeout(async () => {
      const f = pendingClipFields.current[id];
      delete pendingClipFields.current[id];
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateClip", clipId: id, fields: f }),
      });
      setSaveState("saved");
    }, delayMs);
  }

  function setTransition(clipId: string, type: TransitionType) {
    changeClip(clipId, { transitionIn: type }, 0);
    setOpenJoin(null);
  }

  // ---------- split / duplicate / edge trim ----------
  const trimming = useRef(false);
  const splitRef = useRef<() => void>(() => {});

  async function clipAction(body: Record<string, unknown>) {
    pushHistory();
    setSaveState("saving");
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setProject((await res.json()) as Project);
    setSaveState("saved");
    return res.ok;
  }

  async function splitAtPlayhead() {
    const p = placed.find((x) => timeMs >= x.startMs + 500 && timeMs <= x.endMs - 500);
    if (!p) return;
    const ok = await clipAction({ action: "splitClip", clipId: p.clip.id, atMs: timeMs - p.startMs });
    if (ok) setSelectedClipId(null);
  }
  splitRef.current = splitAtPlayhead;

  async function duplicateSelected() {
    if (!selectedClipId) return;
    await clipAction({ action: "duplicateClip", clipId: selectedClipId });
  }

  function startEdgeTrim(e: React.MouseEvent, clip: Clip, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();
    const width = tracksRef.current?.getBoundingClientRect().width ?? 0;
    if (!width || !totalMs) return;
    trimming.current = true;
    setSelectedClipId(clip.id);
    setSelectedCaptionId(null);
    const startX = e.clientX;
    const msPerPx = totalMs / width;
    const orig = { trim: clip.trimStartMs, dur: clip.durationMs, src: clip.sourceDurationMs };
    const move = (ev: MouseEvent) => {
      const dMs = (ev.clientX - startX) * msPerPx;
      if (edge === "right") {
        const dur = Math.round(Math.min(orig.src - orig.trim, Math.max(500, orig.dur + dMs)) / 50) * 50;
        changeClip(clip.id, { durationMs: dur });
      } else {
        const d = Math.round(Math.min(orig.dur - 500, Math.max(-orig.trim, dMs)) / 50) * 50;
        changeClip(clip.id, { trimStartMs: orig.trim + d, durationMs: orig.dur - d });
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setTimeout(() => (trimming.current = false), 0);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  async function saveTitle() {
    if (title === project.title) return;
    await patch({ title });
  }

  async function exportMp4() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "video").replace(/[^\w\- ]+/g, "").trim() || "video"}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setExportError(String((e as Error).message ?? e).slice(0, 300));
    } finally {
      setExporting(false);
    }
  }

  async function deleteProject() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3500);
      return;
    }
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    router.push("/");
  }

  // ---------- playback ----------
  const seek = useCallback(
    (ms: number) => {
      const t = Math.max(0, Math.min(totalMs, ms));
      timeRef.current = t;
      setTimeMs(t);
    },
    [totalMs],
  );

  const togglePlay = useCallback(() => {
    if (!totalMs) return;
    if (!playing && timeRef.current >= totalMs - 50) seek(0);
    setPlaying((p) => !p);
  }, [playing, totalMs, seek]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let t = timeRef.current + dt;
      if (t >= totalMs) {
        t = totalMs;
        setPlaying(false);
      }
      timeRef.current = t;
      setTimeMs(t);
      if (t < totalMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, totalMs]);

  // Keep every video layer and the voiceover in step with the playhead.
  useEffect(() => {
    placed.forEach((p, i) => {
      const v = videoRefs.current[p.clip.id];
      if (!v) return;
      const st = layerAt(placed, i, timeMs);
      const want = st.localMs / 1000;
      if (st.visible) {
        if (playing) {
          if (v.paused) v.play().catch(() => {});
          if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
        }
      } else if (!v.paused) {
        v.pause();
      }
    });
    const a = audioRef.current;
    if (a && audioUrl) {
      const want = timeMs / 1000;
      const inRange = timeMs < audioMs;
      if (playing && inRange) {
        if (a.paused) a.play().catch(() => {});
        if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
      } else {
        if (!a.paused) a.pause();
        if (inRange && Math.abs(a.currentTime - want) > 0.05) a.currentTime = want;
      }
    }
  }, [timeMs, playing, placed, audioUrl, audioMs]);

  // Background music: loops under the whole video, volume from the inspector.
  useEffect(() => {
    const m = musicRef.current;
    if (!m || !project.musicUrl) return;
    const base = Math.min(1, Math.max(0, project.musicVolume / 100));
    const fadeMs = project.musicFadeMs;
    const left = totalMs - timeRef.current;
    m.volume = fadeMs > 0 && playing ? base * Math.min(1, Math.max(0, left / fadeMs)) : base;
    if (playing) {
      if (m.paused) m.play().catch(() => {});
    } else if (!m.paused) {
      m.pause();
    }
  }, [playing, timeMs, totalMs, project.musicUrl, project.musicVolume, project.musicFadeMs]);
  useEffect(() => {
    const m = musicRef.current;
    if (!m || !project.musicUrl || playing) return;
    if (m.duration && Number.isFinite(m.duration)) m.currentTime = (timeMs / 1000) % m.duration;
  }, [timeMs, playing, project.musicUrl]);

  useEffect(() => {
    if (timeRef.current > totalMs) seek(totalMs);
  }, [totalMs, seek]);

  function seekFromEvent(e: React.MouseEvent) {
    const el = tracksRef.current;
    if (!el || !totalMs) return;
    const r = el.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * totalMs);
  }

  // ---------- keyboard ----------
  useEffect(() => {
    async function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undoRef.current();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        splitRef.current();
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedCaptionId) {
        e.preventDefault();
        const captions = project.captions.filter((c) => c.id !== selectedCaptionId);
        setSelectedCaptionId(null);
        setProject((p) => ({ ...p, captions }));
        await patch({ captions });
        return;
      }
      if (selectedClipId) {
        e.preventDefault();
        pushHistory();
        setSaveState("saving");
        const res = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "removeClip", clipId: selectedClipId }),
        });
        if (res.ok) {
          setProject((await res.json()) as Project);
          setSelectedClipId(null);
        }
        setSaveState("saved");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClipId, selectedCaptionId, project.id, project.captions, patch, togglePlay, pushHistory]);

  // ---------- footage: Pexels ----------
  async function searchPexels(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/pexels?q=${encodeURIComponent(query)}&per_page=20`);
      if (res.ok) setVideos(await res.json());
    } finally {
      setSearching(false);
    }
  }

  const addClip = useCallback(
    async (clip: Omit<Clip, "id" | "projectId" | "order" | "transitionIn" | "transitionMs">) => {
      pushHistory();
      setSaveState("saving");
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addClip", clip }),
      });
      if (res.ok) await reloadProject();
      if (res.ok && clip.source === "fal") loadLibrary();
      setSaveState("saved");
      return res.ok;
    },
    [project.id, reloadProject, pushHistory, loadLibrary],
  );

  function addPexelsClip(v: PexelsVideo) {
    return addClip({
      durationMs: Math.min(v.durationMs, DEFAULT_CLIP_MS),
      sourceDurationMs: v.durationMs,
      trimStartMs: 0,
      source: "pexels",
      pexelsVideoId: v.id,
      pexelsUrl: v.url,
      pexelsThumbnail: v.thumbnail,
      pexelsAuthor: v.author,
      pexelsWidth: v.width,
      pexelsHeight: v.height,
    });
  }

  useEffect(() => {
    if (hoverVideo && hoverVideoRef.current) {
      hoverVideoRef.current.load();
      hoverVideoRef.current.play().catch(() => {});
    }
  }, [hoverVideo]);

  // ---------- footage: fal.ai ----------
  useEffect(() => {
    setFalJobs(loadJobs(project.id));
  }, [project.id]);

  useEffect(() => {
    if (tab === "footage" && footageSource === "fal") loadLibrary();
  }, [tab, footageSource, loadLibrary]);

  const updateJobs = useCallback(
    (fn: (jobs: FalJob[]) => FalJob[]) => {
      setFalJobs((prev) => {
        const next = fn(prev);
        saveJobs(project.id, next);
        return next;
      });
    },
    [project.id],
  );

  async function approveFal() {
    if (!approval) return;
    setFalError("");
    const res = await fetch("/api/fal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, prompt: approval.prompt, duration: approval.seconds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFalError(data.error === "Over budget for this project" ? "That would go over this project's AI budget." : `fal.ai refused the request. ${typeof data.detail === "string" ? data.detail.slice(0, 160) : ""}`);
      return;
    }
    setProject((p) => ({ ...p, spentCents: data.spentCents }));
    updateJobs((jobs) => [
      ...jobs,
      {
        id: data.requestId,
        prompt: approval.prompt,
        durationMs: data.durationMs,
        costCents: data.costCents,
        statusUrl: data.statusUrl,
        responseUrl: data.responseUrl,
        status: "IN_QUEUE",
      },
    ]);
    setApproval(null);
    setFalPrompt("");
  }

  const activeJobs = falJobs.filter((j) => j.status === "IN_QUEUE" || j.status === "IN_PROGRESS" || j.status === "COMPLETED");
  useEffect(() => {
    if (!activeJobs.length) return;
    let cancelled = false;
    const poll = async () => {
      for (const job of activeJobs) {
        const qs = new URLSearchParams({ statusUrl: job.statusUrl, responseUrl: job.responseUrl });
        const res = await fetch(`/api/fal?${qs}`, { cache: "no-store" }).catch(() => null);
        if (!res || cancelled) continue;
        const data = await res.json().catch(() => ({}));
        if (data.status === "COMPLETED" && data.videoUrl) {
          updateJobs((jobs) => jobs.map((j) => (j.id === job.id ? { ...j, status: "ADDED" } : j)));
          await addClip({
            durationMs: job.durationMs,
            sourceDurationMs: job.durationMs,
            trimStartMs: 0,
            source: "fal",
            pexelsVideoId: 0,
            pexelsUrl: data.videoUrl,
            pexelsThumbnail: "",
            pexelsAuthor: `AI · ${job.prompt.slice(0, 60)}`,
            pexelsWidth: 1080,
            pexelsHeight: 1920,
          });
        } else if (data.status === "ERROR") {
          updateJobs((jobs) => jobs.map((j) => (j.id === job.id ? { ...j, status: "ERROR", error: String(data.detail ?? "Generation failed").slice(0, 200) } : j)));
        } else if (data.status) {
          updateJobs((jobs) => jobs.map((j) => (j.id === job.id ? { ...j, status: data.status, queuePosition: data.queuePosition } : j)));
        }
      }
    };
    poll();
    const timer = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  // ---------- timeline drag ----------
  function onClipDragStart(e: React.DragEvent, clipId: string) {
    pushHistory();
    dragClipId.current = clipId;
    dragTransition.current = null;
    e.dataTransfer.effectAllowed = "move";
  }

  function onClipDragOver(e: React.DragEvent, targetId: string) {
    if (!dragClipId.current) return;
    e.preventDefault();
    if (dragClipId.current === targetId) return;
    const clips = [...project.clips];
    const fromIdx = clips.findIndex((c) => c.id === dragClipId.current);
    const toIdx = clips.findIndex((c) => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = clips.splice(fromIdx, 1);
    clips.splice(toIdx, 0, moved);
    setProject((p) => ({ ...p, clips }));
  }

  async function onClipDrop() {
    if (!dragClipId.current) return;
    dragClipId.current = null;
    setSaveState("saving");
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorderClips", orderedIds: project.clips.map((c) => c.id) }),
    });
    setSaveState("saved");
  }

  function onChipDragStart(e: React.DragEvent, t: TransitionType) {
    dragTransition.current = t;
    dragClipId.current = null;
    e.dataTransfer.setData("text/plain", t);
    e.dataTransfer.effectAllowed = "copy";
  }

  // ---------- Claude ----------
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setChatInput("");
    setStreaming(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, projectTitle: project.title, clipsCount: project.clips.length }),
      });
      if (!res.ok || !res.body) {
        setMessages([...history, { role: "assistant", content: "Sorry, Claude couldn't answer just now." }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            full += json.delta?.text ?? "";
            setMessages([...history, { role: "assistant", content: full }]);
          } catch {
            // not JSON
          }
        }
      }
      const match = full.match(/<voiceover>([\s\S]*?)<\/voiceover>/);
      if (match) {
        const script = match[1].trim();
        setVoiceoverScript(script);
        await patch({ voiceoverScript: script });
      }
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function generateVoiceover() {
    if (!voiceoverScript.trim()) return;
    setGeneratingAudio(true);
    setVoiceError("");
    try {
      const res = await fetch("/api/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: voiceoverScript }),
      });
      const data = (await res.json().catch(() => ({}))) as { audioUrl?: string; words?: CaptionWord[] };
      if (!res.ok || !data.audioUrl) {
        setVoiceError("ElevenLabs couldn't make the voiceover.");
        return;
      }
      const captions = buildCaptions(data.words ?? []);
      setAudioUrl(data.audioUrl);
      setProject((p) => ({ ...p, captions }));
      await patch({ voiceoverUrl: data.audioUrl, voiceoverScript, captions });
    } finally {
      setGeneratingAudio(false);
    }
  }

  // ---------- captions ----------
  async function autoCaption() {
    const words = wordsFromScript(voiceoverScript, audioMs);
    if (!words.length) return;
    const captions = buildCaptions(words);
    setProject((p) => ({ ...p, captions }));
    await patch({ captions });
  }

  function editCaption(id: string, text: string) {
    const captions = project.captions.map((c) =>
      c.id === id ? { ...c, text, words: c.words.length === text.split(/\s+/).length ? c.words.map((w, i) => ({ ...w, text: text.split(/\s+/)[i] })) : [] } : c,
    );
    setProject((p) => ({ ...p, captions }));
  }

  function setCaptionStyle(style: CaptionStyle) {
    setProject((p) => ({ ...p, captionStyle: style }));
    patch({ captionStyle: style });
  }

  // ---------- render helpers ----------
  const currentCaption = captionAt(project.captions, timeMs);
  const sceneIdx = placed.findIndex((p) => timeMs >= p.startMs && timeMs < p.endMs);
  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedClipIdx = project.clips.findIndex((c) => c.id === selectedClipId);
  const selectedCaption = project.captions.find((c) => c.id === selectedCaptionId) ?? null;
  const budgetLeft = project.budgetCents - project.spentCents;
  const falCost = falSeconds === 10 ? 70 : 35;
  const ticks = totalMs > 0 ? [0, 0.2, 0.4, 0.6, 0.8].map((f) => f * totalMs) : [];

  // White flash transition: the white fades away over the clip's transition time.
  const flashOpacity = (() => {
    for (let i = 1; i < placed.length; i++) {
      const c = placed[i].clip;
      if (c.transitionIn !== "flash") continue;
      const T = Math.max(50, c.transitionMs);
      const d = timeMs - placed[i].startMs;
      if (d >= 0 && d < T) return Math.pow(1 - d / T, 3);
    }
    return 0;
  })();

  fxRef.current = project.effects;
  const fxNow = effectState(project.effects, timeMs);
  const selectedEffect = project.effects.find((e) => e.id === selectedEffectId) ?? null;

  function saveEffects(next: Effect[]) {
    fxRef.current = next;
    setProject((p) => ({ ...p, effects: next }));
    patch({ effects: next });
  }

  function dropEffect(e: React.DragEvent) {
    const type = dragEffect.current ?? (e.dataTransfer.getData("text/effect") as EffectType);
    dragEffect.current = null;
    const def = FX_LIST.find((x) => x.id === type);
    const rect = tracksRef.current?.getBoundingClientRect();
    if (!def || !rect || !totalMs) return;
    e.preventDefault();
    const at = Math.round(((e.clientX - rect.left) / rect.width) * totalMs / 50) * 50;
    const dur = Math.min(def.defaultMs, totalMs);
    const startMs = Math.max(0, Math.min(totalMs - dur, at - Math.round(dur / 2)));
    const fx: Effect = { id: `fx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type, startMs, durationMs: dur, strength: 60 };
    saveEffects([...fxRef.current, fx]);
    setSelectedEffectId(fx.id);
    setSelectedClipId(null);
    setSelectedCaptionId(null);
  }

  /** Move an effect block (mode "move") or pull one of its edges. */
  function startEffectDrag(ev: React.MouseEvent, fx: Effect, mode: "move" | "left" | "right") {
    ev.preventDefault();
    ev.stopPropagation();
    const width = tracksRef.current?.getBoundingClientRect().width ?? 0;
    if (!width || !totalMs) return;
    setSelectedEffectId(fx.id);
    setSelectedClipId(null);
    setSelectedCaptionId(null);
    const startX = ev.clientX;
    const msPerPx = totalMs / width;
    const o = { s: fx.startMs, d: fx.durationMs };
    const snap = (n: number) => Math.round(n / 50) * 50;
    let moved = false;
    const apply = (ev2: MouseEvent) => {
      moved = true;
      const dMs = (ev2.clientX - startX) * msPerPx;
      let s0 = o.s;
      let d0 = o.d;
      if (mode === "move") s0 = Math.max(0, Math.min(totalMs - o.d, snap(o.s + dMs)));
      if (mode === "left") {
        const end = o.s + o.d;
        s0 = Math.max(0, Math.min(end - 100, snap(o.s + dMs)));
        d0 = end - s0;
      }
      if (mode === "right") d0 = Math.max(100, Math.min(totalMs - o.s, snap(o.d + dMs)));
      const next = fxRef.current.map((x) => (x.id === fx.id ? { ...x, startMs: s0, durationMs: d0 } : x));
      fxRef.current = next;
      setProject((p) => ({ ...p, effects: next }));
    };
    const up = () => {
      window.removeEventListener("mousemove", apply);
      window.removeEventListener("mouseup", up);
      if (moved) patch({ effects: fxRef.current });
    };
    window.addEventListener("mousemove", apply);
    window.addEventListener("mouseup", up);
  }

  function setLook(next: Partial<Look>, save = false) {
    const look = { ...project.look, ...next };
    setProject((p) => ({ ...p, look }));
    if (save) patch({ look });
  }

  function renderCaption(c: Caption) {
    const style = project.captionStyle;
    if (style === "tiktok") {
      // Phone preview is 252px wide for a 1080px video, so 96px in the export is about 22px here.
      let active = -1;
      c.words.forEach((w, i) => {
        if (timeMs >= w.startMs) active = i;
      });
      const base = { fontFamily: "Poppins, Montserrat, 'Arial Black', Arial, sans-serif", fontWeight: 700, fontSize: 22, lineHeight: 1.12, textTransform: "uppercase", letterSpacing: 0.3, WebkitTextStroke: "4px #000", paintOrder: "stroke fill", textShadow: "0 2px 0 rgba(0,0,0,0.9)" } as const;
      if (!c.words.length) return <span style={{ ...base, color: "#fff" }}>{c.text}</span>;
      return (
        <span style={base}>
          {c.words.map((w, i) => (
            <span key={i} style={{ display: "inline-block", color: i === active ? "#ffe14d" : "#fff", transform: i === active ? "scale(1.12)" : "scale(1)", transition: "transform 90ms ease-out", marginRight: i < c.words.length - 1 ? "0.28em" : 0 }}>
              {w.text}
            </span>
          ))}
        </span>
      );
    }
    if (style === "neon") {
      return (
        <span style={{ fontFamily: "Poppins, Montserrat, 'Arial Black', Arial, sans-serif", fontWeight: 700, fontSize: 18, lineHeight: 1.15, textTransform: "uppercase", letterSpacing: 0.5, color: "#f4ffd8", textShadow: "0 0 3px #f0f028, 0 0 8px #f0f028, 0 0 16px rgba(240,240,40,0.7)" }}>{c.text}</span>
      );
    }
    if (style === "karaoke" && c.words.length) {
      return (
        <span style={{ fontWeight: 800, fontSize: 22, lineHeight: 1.15, textShadow: "0 2px 8px rgba(0,0,0,0.75), 0 0 2px #000" }}>
          {c.words.map((w, i) => (
            <span key={i} style={{ color: timeMs >= w.startMs ? "#ffe14d" : "#fff" }}>
              {w.text}{i < c.words.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      );
    }
    if (style === "box") {
      return (
        <span style={{ background: "rgba(0,0,0,0.78)", color: "#fff", fontWeight: 700, fontSize: 18, lineHeight: 1.5, padding: "3px 8px", borderRadius: 6, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
          {c.text}
        </span>
      );
    }
    return (
      <span style={{ color: "#fff", fontWeight: 800, fontSize: 22, lineHeight: 1.15, textShadow: "0 2px 8px rgba(0,0,0,0.75), 0 0 2px #000" }}>{c.text}</span>
    );
  }

  const label = { fontSize: 11, color: "var(--muted)", marginBottom: 6 } as const;
  const chip = { background: "var(--border)", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "grab", color: "var(--text)", userSelect: "none" } as const;

  return (
    <div className="ed-root" style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* ---------------- left panel ---------------- */}
      <div className="ed-left" style={{ width: 340, minWidth: 280, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--panel)" }}>
        <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 8 }}>
          <a href="/" aria-label="Back to projects" style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1 }}>←</a>
          <input
            aria-label="Project title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            style={{ flex: 1, fontWeight: 600, background: "transparent", border: "none", borderRadius: 0, padding: "2px 4px", fontSize: 14 }}
          />
          <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{saveState === "saving" ? "Saving…" : "Saved"}</span>
          <button onClick={deleteProject} aria-label={confirmDelete ? "Confirm delete project" : "Delete project"} style={confirmDelete ? { background: "var(--accent)", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, borderRadius: 6, padding: "4px 8px" } : { background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }} title="Delete project">{confirmDelete ? "Delete?" : "🗑"}</button>
        </div>

        <div className="row" style={{ borderBottom: "1px solid var(--border)", gap: 0 }}>
          {(["footage", "claude"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent", color: tab === t ? "var(--text)" : "var(--muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t ? 600 : 400 }}>
              {t === "footage" ? "🎬 Footage" : "🤖 Claude"}
            </button>
          ))}
        </div>

        {tab === "footage" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 12px 0", display: "flex", gap: 4 }}>
              {([["pexels", "Stock"], ["fal", "AI clip"], ["brand", "Brand"]] as const).map(([id, name]) => (
                <button key={id} onClick={() => setFootageSource(id)} style={{ flex: 1, padding: "6px 0", borderRadius: 999, fontSize: 12, cursor: "pointer", border: footageSource === id ? "1px solid var(--text)" : "1px solid var(--border)", background: footageSource === id ? "var(--text)" : "transparent", color: footageSource === id ? "var(--bg)" : "var(--muted)", fontWeight: 600 }}>
                  {name}
                </button>
              ))}
            </div>

            {footageSource === "brand" && (
              <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignContent: "start" }}>
                {[{ id: "curfew-end", name: "Curfew end card", url: "/brand/curfew-endcard.png" }].map((b) => (
                  <div key={b.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.url} alt={b.name} style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.7))", padding: "12px 6px 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#fff" }}>{b.name}</span>
                      <button onClick={() => addClip({ durationMs: 3000, sourceDurationMs: 60000, trimStartMs: 0, source: "image", pexelsVideoId: 0, pexelsUrl: b.url, pexelsThumbnail: b.url, pexelsAuthor: "Brand", pexelsWidth: 1080, pexelsHeight: 1920 })} aria-label="Add to timeline" style={{ background: "var(--accent)", border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {footageSource === "pexels" && (
              <>
                {hoverVideo && (
                  <div style={{ padding: 8, borderBottom: "1px solid var(--border)", background: "var(--bg)", marginTop: 10 }}>
                    <video ref={hoverVideoRef} src={hoverVideo.url} muted loop playsInline style={{ width: "100%", borderRadius: 6, maxHeight: 200, objectFit: "cover" }} />
                    <p style={{ fontSize: 11, marginTop: 4 }} className="muted">{fmtTime(hoverVideo.durationMs)} · by {hoverVideo.author}</p>
                  </div>
                )}
                <form onSubmit={searchPexels} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
                  <input aria-label="Search Pexels" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search portrait stock footage…" style={{ flex: 1, fontSize: 13 }} />
                  <button className="primary" type="submit" style={{ padding: "6px 12px", fontSize: 13 }} disabled={searching}>{searching ? "…" : "Go"}</button>
                </form>
                <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignContent: "start" }}>
                  {videos.map((v) => (
                    <div key={v.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }} onMouseEnter={() => setHoverVideo(v)} onMouseLeave={() => setHoverVideo(null)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.thumbnail} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.7))", padding: "12px 6px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <span style={{ fontSize: 10, color: "#fff" }}>{fmtTime(v.durationMs)}</span>
                        <button onClick={() => addPexelsClip(v)} aria-label="Add to timeline" style={{ background: "var(--accent)", border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 12, cursor: "pointer" }}>+</button>
                      </div>
                    </div>
                  ))}
                  {!videos.length && !searching && (
                    <p className="muted" style={{ gridColumn: "1/-1", textAlign: "center", fontSize: 12, padding: 16 }}>Search for portrait footage above. New clips start at 5 seconds; trim them in the inspector.</p>
                  )}
                </div>
              </>
            )}

            {footageSource === "fal" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }} htmlFor="fal-prompt">Describe the shot</label>
                <textarea id="fal-prompt" value={falPrompt} onChange={(e) => setFalPrompt(e.target.value)} rows={4} placeholder="Close-up of a sourdough loaf collapsing on a wooden counter, warm morning light, slow push in" style={{ fontSize: 12, resize: "vertical" }} />
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontSize: 12 }} className="muted">Length</span>
                  {([5, 10] as const).map((s) => (
                    <button key={s} onClick={() => setFalSeconds(s)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: falSeconds === s ? "var(--border)" : "transparent", color: "var(--text)" }}>{s}s</button>
                  ))}
                  <span style={{ marginLeft: "auto", fontSize: 12 }} className="muted">{money(falCost)}</span>
                </div>
                <p className="muted" style={{ fontSize: 11 }}>Kling 2.5 Turbo via fal.ai, 9:16. Takes about 1 to 3 minutes. Budget left for this project: {money(budgetLeft)}.</p>
                <button className="primary" style={{ fontSize: 13, padding: "8px 0" }} disabled={!falPrompt.trim() || !!approval} onClick={() => setApproval({ prompt: falPrompt.trim(), seconds: falSeconds, costCents: falCost })}>
                  Generate AI clip
                </button>

                {approval && (
                  <div style={{ border: "1px solid #e0a040", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, background: "#1f1a12" }}>
                    <div style={{ fontSize: 12, color: "#e0a040", fontWeight: 600 }}>Approval needed: fal.ai clip</div>
                    <div style={{ fontSize: 12, color: "#c4c4cc" }}>
                      About {approval.seconds} seconds at 1080p. Cost {money(approval.costCents)}. Budget left {money(budgetLeft)}.
                    </div>
                    {approval.costCents > budgetLeft && <div style={{ fontSize: 12, color: "#ff8a8a" }}>Not enough budget left for this clip.</div>}
                    <div className="row">
                      <button onClick={approveFal} disabled={approval.costCents > budgetLeft} style={{ background: "#e8e8ea", border: 0, color: "#121214", borderRadius: 6, padding: "6px 12px", fontWeight: 600, cursor: "pointer" }}>Approve</button>
                      <button onClick={() => setApproval(null)} style={{ background: "none", border: "1px solid #3a3a40", color: "#e8e8ea", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>Skip</button>
                    </div>
                  </div>
                )}
                {falError && <p style={{ fontSize: 12, color: "#ff8a8a" }}>{falError}</p>}

                {falJobs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                    <p style={{ fontSize: 12, fontWeight: 600 }}>AI clips</p>
                    {[...falJobs].reverse().map((j) => (
                      <div key={j.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.prompt}</span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {j.status === "IN_QUEUE" && `Queued${j.queuePosition != null ? ` (#${j.queuePosition})` : ""}…`}
                          {j.status === "IN_PROGRESS" && "Generating…"}
                          {j.status === "COMPLETED" && "Adding to timeline…"}
                          {j.status === "ADDED" && "Added to timeline"}
                          {j.status === "ERROR" && `Failed: ${j.error ?? ""}`}
                          {" · "}{money(j.costCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {library.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    <p style={{ fontSize: 12, fontWeight: 600 }}>Your saved AI clips</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {library.map((l) => (
                        <div key={l.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg)" }}>
                          <video src={`${l.url}#t=0.5`} muted playsInline preload="metadata" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                          <button onClick={() => removeFromLibrary(l.id)} aria-label="Remove from saved clips" title="Remove from saved clips" style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.65)", border: "none", color: "#fff", borderRadius: 999, width: 20, height: 20, cursor: "pointer", fontSize: 11, lineHeight: 1 }}>✕</button>
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.75))", padding: "14px 6px 6px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 10, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(l.label || "AI clip").replace(/^AI · /, "")}</span>
                            <button
                              onClick={() => addClip({ durationMs: Math.min(l.durationMs, DEFAULT_CLIP_MS), sourceDurationMs: l.durationMs, trimStartMs: 0, source: "fal", pexelsVideoId: 0, pexelsUrl: l.url, pexelsThumbnail: "", pexelsAuthor: l.label || "AI clip", pexelsWidth: 1080, pexelsHeight: 1920 })}
                              aria-label="Add to timeline"
                              style={{ background: "var(--accent)", border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}
                            >+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "claude" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.length === 0 && (
                <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 20 }}>Ask Claude to plan your video, write a voiceover script, or suggest footage searches.</p>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "var(--accent)" : "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", maxWidth: "90%", fontSize: 13, color: m.role === "user" ? "#fff" : "var(--text)", whiteSpace: "pre-wrap" }}>
                  {m.content.replace(/<\/?voiceover>/g, "").trim() || (streaming && i === messages.length - 1 ? "…" : "")}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="vo-script" style={{ fontSize: 12, fontWeight: 600 }}>Voiceover script</label>
              <textarea id="vo-script" value={voiceoverScript} onChange={(e) => setVoiceoverScript(e.target.value)} onBlur={() => patch({ voiceoverScript })} placeholder="Claude fills this when it writes a script, or type your own…" rows={4} style={{ fontSize: 12, resize: "vertical" }} />
              <button className="primary" onClick={generateVoiceover} disabled={!voiceoverScript.trim() || generatingAudio} style={{ fontSize: 12, padding: "6px 0" }}>
                {generatingAudio ? "Generating…" : audioUrl ? "🎙 Regenerate voiceover + captions" : "🎙 Generate voiceover + captions"}
              </button>
              {voiceError && <p style={{ fontSize: 12, color: "#ff8a8a" }}>{voiceError}</p>}
            </div>
            <form onSubmit={sendMessage} style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 6 }}>
              <input aria-label="Message Claude" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message Claude…" disabled={streaming} style={{ flex: 1, fontSize: 13 }} />
              <button className="primary" type="submit" aria-label="Send" disabled={streaming || !chatInput.trim()} style={{ padding: "6px 12px", fontSize: 13 }}>{streaming ? "…" : "↑"}</button>
            </form>
          </div>
        )}
      </div>

      {/* ---------------- main ---------------- */}
      <div className="ed-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="ed-mobilebar">
          <a href="/" style={{ color: "var(--text)", fontWeight: 600 }}>← Projects</a>
          <span className="muted" style={{ fontSize: 12 }}>{saveState === "saving" ? "Saving…" : "Saved"}</span>
        </div>
        <div className="ed-top" style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* preview */}
          <div className="ed-preview" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#0b0b0d", position: "relative" }}>
            <span className="muted" style={{ position: "absolute", left: 14, top: 12, fontSize: 12 }}>9:16 · 1080 × 1920</span>
            <div style={{ position: "absolute", right: 14, top: 8, display: "flex", alignItems: "center", gap: 10, zIndex: 5 }}>
              {exportError && <span style={{ fontSize: 11, color: "#ff6b6b", maxWidth: 360 }} title={exportError}>{exportError}</span>}
              <button
                onClick={exportMp4}
                disabled={exporting || project.clips.length === 0}
                style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: exporting || project.clips.length === 0 ? "default" : "pointer", opacity: exporting || project.clips.length === 0 ? 0.6 : 1 }}
              >
                {exporting ? "Rendering… (about a minute)" : "Export MP4"}
              </button>
            </div>
            <div onClick={togglePlay} style={{ position: "relative", width: 252, height: 448, background: "#111", borderRadius: 16, overflow: "hidden", boxShadow: "0 0 0 1px var(--border)", cursor: totalMs ? "pointer" : "default" }}>
              <div style={{ position: "absolute", inset: 0, transform: fxNow.transform, filter: fxNow.filter, transformOrigin: "center" }}>
              {placed.map((p, i) => {
                const st = layerAt(placed, i, timeMs);
                return (
                  p.clip.source === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={p.clip.id}
                      src={p.clip.pexelsUrl}
                      alt=""
                      draggable={false}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", visibility: st.visible ? "visible" : "hidden", opacity: st.style.opacity, transform: st.style.transform, filter: st.style.filter, zIndex: st.style.zIndex }}
                    />
                  ) : (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    key={p.clip.id}
                    ref={(el) => {
                      videoRefs.current[p.clip.id] = el;
                    }}
                    src={p.clip.pexelsUrl}
                    muted
                    playsInline
                    preload="auto"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", visibility: st.visible ? "visible" : "hidden", opacity: st.style.opacity, transform: st.style.transform, filter: st.style.filter, zIndex: st.style.zIndex }}
                  />
                  )
                );
              })}
              </div>
              {!placed.length && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="muted" style={{ fontSize: 13 }}>No clips yet</span>
                </div>
              )}
              {project.look.vignette > 0 && (
                <div style={{ position: "absolute", inset: 0, zIndex: 90, pointerEvents: "none", background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(project.look.vignette / 100) * 0.85}) 100%)` }} />
              )}
              {project.look.scanlines > 0 && (
                <div style={{ position: "absolute", inset: 0, zIndex: 91, pointerEvents: "none", background: `repeating-linear-gradient(to bottom, rgba(0,0,0,${(project.look.scanlines / 100) * 0.4}) 0px, rgba(0,0,0,${(project.look.scanlines / 100) * 0.4}) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 2px)` }} />
              )}
              {project.look.grain > 0 && (
                <div style={{ position: "absolute", inset: 0, zIndex: 92, pointerEvents: "none", opacity: (project.look.grain / 100) * 0.35, mixBlendMode: "overlay", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='120' height='120' filter='url(%23n)'/></svg>\")" }} />
              )}
              {Math.max(flashOpacity, fxNow.flash) > 0 && (
                <div style={{ position: "absolute", inset: 0, zIndex: 95, pointerEvents: "none", background: "#fff", opacity: Math.max(flashOpacity, fxNow.flash) }} />
              )}
              {currentCaption && (
                <div style={{ position: "absolute", left: 14, right: 14, bottom: "27%", textAlign: "center", zIndex: 100, pointerEvents: "none" }}>
                  {renderCaption(currentCaption)}
                </div>
              )}
              {!playing && totalMs > 0 && (
                <div style={{ position: "absolute", inset: 0, zIndex: 101, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20 }}>▶</div>
                </div>
              )}
            </div>
            <span className="muted" style={{ fontSize: 11 }}>
              {placed.length ? `Scene ${Math.max(1, sceneIdx + 1)} of ${placed.length} · ` : ""}{fmtTime(timeMs)}
            </span>
            {project.musicUrl && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio ref={musicRef} src={project.musicUrl} loop preload="auto" style={{ display: "none" }} />
            )}
            {audioUrl && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio ref={audioRef} src={audioUrl} preload="auto" onLoadedMetadata={(e) => setAudioMs(Math.round(e.currentTarget.duration * 1000))} style={{ display: "none" }} />
            )}
          </div>

          {/* inspector */}
          <aside className="ed-aside" style={{ width: 260, flexShrink: 0, borderLeft: "1px solid var(--border)", padding: 14, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", background: "var(--panel)" }}>
            {selectedClip ? (
              <>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 13 }}>Clip {selectedClipIdx + 1}</p>
                  <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>{selectedClip.source === "fal" ? "AI clip · fal.ai" : selectedClip.source === "image" ? "Brand card" : `Pexels · ${selectedClip.pexelsAuthor}`}</p>
                </div>
                <div>
                  <p style={label}>Transition in</p>
                  {selectedClipIdx === 0 ? (
                    <p className="muted" style={{ fontSize: 12 }}>First clip: the video starts here.</p>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                        {TRANSITIONS.map((t) => (
                          <button key={t.id} onClick={() => setTransition(selectedClip.id, t.id)} style={{ padding: "6px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: selectedClip.transitionIn === t.id ? "var(--border)" : "transparent", color: "var(--text)" }}>{t.label}</button>
                        ))}
                      </div>
                      {selectedClip.transitionIn !== "cut" && (
                        <div className="row" style={{ marginTop: 8, gap: 4 }}>
                          <span className="muted" style={{ fontSize: 11 }}>Length</span>
                          {[300, 500, 800].map((ms) => (
                            <button key={ms} onClick={() => changeClip(selectedClip.id, { transitionMs: ms }, 0)} style={{ flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: selectedClip.transitionMs === ms ? "var(--border)" : "transparent", color: "var(--text)" }}>{ms / 1000}s</button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <label style={{ ...label, display: "flex", justifyContent: "space-between" }} htmlFor="clip-len">
                    <span>Length</span><span>{(selectedClip.durationMs / 1000).toFixed(1)}s</span>
                  </label>
                  <input id="clip-len" type="range" min={1000} max={Math.max(1000, selectedClip.sourceDurationMs - selectedClip.trimStartMs)} step={100} value={selectedClip.durationMs} onChange={(e) => changeClip(selectedClip.id, { durationMs: Number(e.target.value) })} style={{ padding: 0, accentColor: "var(--accent)" }} />
                </div>
                <div>
                  <label style={{ ...label, display: "flex", justifyContent: "space-between" }} htmlFor="clip-start">
                    <span>Starts at (in source)</span><span>{(selectedClip.trimStartMs / 1000).toFixed(1)}s</span>
                  </label>
                  <input id="clip-start" type="range" min={0} max={Math.max(0, selectedClip.sourceDurationMs - selectedClip.durationMs)} step={100} value={selectedClip.trimStartMs} disabled={selectedClip.sourceDurationMs <= selectedClip.durationMs} onChange={(e) => changeClip(selectedClip.id, { trimStartMs: Number(e.target.value) })} style={{ padding: 0, accentColor: "var(--accent)" }} />
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Source is {(selectedClip.sourceDurationMs / 1000).toFixed(1)}s long.</p>
                </div>
                <p className="muted" style={{ fontSize: 11 }}>Drag clips to reorder, drag their edges to trim, S to split at the playhead, Delete to remove.</p>
              </>
            ) : selectedCaption ? (
              <>
                <p style={{ fontWeight: 600, fontSize: 13 }}>Caption</p>
                <div>
                  <label style={label} htmlFor="cap-text">Text</label>
                  <textarea id="cap-text" value={selectedCaption.text} rows={3} onChange={(e) => editCaption(selectedCaption.id, e.target.value)} onBlur={() => patch({ captions: project.captions })} style={{ fontSize: 13, resize: "vertical" }} />
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{fmtTime(selectedCaption.startMs)} to {fmtTime(selectedCaption.endMs)} · press Delete to remove</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 13 }}>Project</p>
                  <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>1080 × 1920 · 30 fps · {fmtTime(totalMs)}</p>
                  <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Select a clip or caption on the timeline to edit it.</p>
                </div>
              </>
            )}

            <div>
              <p style={label}>Caption style</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {(["tiktok", "bold", "box", "karaoke", "neon"] as const).map((s) => (
                  <button key={s} onClick={() => setCaptionStyle(s)} style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: project.captionStyle === s ? "var(--border)" : "transparent", color: "var(--text)", textTransform: "capitalize" }}>{s === "tiktok" ? "TikTok" : s}</button>
                ))}
              </div>
              {project.captions.length === 0 && (
                <div style={{ marginTop: 10 }}>
                  {audioUrl && voiceoverScript.trim() && audioMs > 0 ? (
                    <>
                      <button onClick={autoCaption} style={{ width: "100%", padding: "7px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--accent)", background: "transparent", color: "var(--text)" }}>Add captions to this voiceover</button>
                      <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Free and instant, timing is approximate. Regenerating the voiceover (Claude tab) gives exact timing.</p>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: 11 }}>No captions yet. In the Claude tab, write a script and press "Generate voiceover + captions".</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <p style={label}>Look</p>
              <div className="row" style={{ gap: 4, marginBottom: 8 }}>
                {LOOK_PRESETS.map((pr) => (
                  <button key={pr.id} onClick={() => setLook(pr.look, true)} style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}>{pr.label}</button>
                ))}
              </div>
              {([["grain", "Grain"], ["scanlines", "Scanlines"], ["vignette", "Vignette"], ["rgb", "Colour split"]] as const).map(([k, name]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <label style={{ ...label, display: "flex", justifyContent: "space-between", marginBottom: 2 }} htmlFor={`look-${k}`}>
                    <span>{name}</span><span>{project.look[k]}</span>
                  </label>
                  <input id={`look-${k}`} type="range" min={0} max={100} step={5} value={project.look[k]} onChange={(e) => setLook({ [k]: Number(e.target.value) })} onMouseUp={() => patch({ look: project.look })} onTouchEnd={() => patch({ look: project.look })} onKeyUp={() => patch({ look: project.look })} style={{ padding: 0, accentColor: "var(--accent)" }} />
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11 }}>Applied when you export. The preview is an approximation, and colour split only shows in the export.</p>
            </div>

            <div>
              <p style={label}>Background music</p>
              {project.musicUrl ? (
                <>
                  <p style={{ fontSize: 12, marginBottom: 6, wordBreak: "break-all" }}>{project.musicName || "Music"}</p>
                  <label style={{ ...label, display: "flex", justifyContent: "space-between" }} htmlFor="music-vol">
                    <span>Volume</span><span>{project.musicVolume}%</span>
                  </label>
                  <input id="music-vol" type="range" min={0} max={100} step={5} value={project.musicVolume} onChange={(e) => setProject((p) => ({ ...p, musicVolume: Number(e.target.value) }))} onMouseUp={() => patch({ musicVolume: project.musicVolume })} onTouchEnd={() => patch({ musicVolume: project.musicVolume })} onKeyUp={() => patch({ musicVolume: project.musicVolume })} style={{ padding: 0, accentColor: "var(--accent)" }} />
                  <div className="row" style={{ marginTop: 8, gap: 4 }}>
                    <span className="muted" style={{ fontSize: 11, marginRight: 2 }}>Fade out</span>
                    {([0, 1000, 2000, 3000] as const).map((ms) => (
                      <button key={ms} onClick={() => { setProject((p) => ({ ...p, musicFadeMs: ms })); patch({ musicFadeMs: ms }); }} style={{ flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: project.musicFadeMs === ms ? "var(--border)" : "transparent", color: "var(--text)" }}>{ms === 0 ? "Off" : `${ms / 1000}s`}</button>
                    ))}
                  </div>
                  <button onClick={() => { setProject((p) => ({ ...p, musicUrl: "", musicName: "" })); patch({ musicUrl: "", musicName: "" }); }} style={{ marginTop: 8, width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}>Remove music</button>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const url = musicInput.trim();
                    if (!/^https?:\/\//i.test(url)) return;
                    const name = decodeURIComponent(url.split("?")[0].split("/").pop() || "Music");
                    setProject((p) => ({ ...p, musicUrl: url, musicName: name }));
                    patch({ musicUrl: url, musicName: name });
                    setMusicInput("");
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <input value={musicInput} onChange={(e) => setMusicInput(e.target.value)} placeholder="Paste a direct link to an mp3" style={{ fontSize: 12 }} />
                  <button type="submit" style={{ padding: "6px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}>Add music</button>
                </form>
              )}
            </div>

            <div style={{ marginTop: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ fontSize: 11 }} className="muted">AI clip budget</p>
              <div style={{ height: 6, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (project.spentCents / Math.max(1, project.budgetCents)) * 100)}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <p style={{ fontSize: 12 }}>{money(project.spentCents)} used of {money(project.budgetCents)}</p>
            </div>
          </aside>
        </div>

        {/* ---------------- timeline ---------------- */}
        <div style={{ height: 348, flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--panel)", display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ height: 42, flexShrink: 0, padding: "0 12px", borderBottom: "1px solid var(--border)", gap: 10 }}>
            <button onClick={togglePlay} disabled={!totalMs} aria-label={playing ? "Pause" : "Play"} style={{ background: "#e8e8ea", border: 0, color: "#121214", borderRadius: 6, padding: "5px 14px", fontWeight: 600, cursor: totalMs ? "pointer" : "default", opacity: totalMs ? 1 : 0.5 }}>
              {playing ? "Pause" : "Play"}
            </button>
            <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, color: "#c4c4cc" }}>{fmtTime(timeMs)} / {fmtTime(totalMs)}</span>
            <span className="muted" style={{ fontSize: 11 }}>Space to play</span>
            <button onClick={splitAtPlayhead} title="Cut the clip under the playhead in two (S)" style={{ ...chip, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}>Split (S)</button>
            <button onClick={() => undo()} disabled={!canUndo} title="Undo the last clip change (Ctrl+Z)" style={{ ...chip, cursor: canUndo ? "pointer" : "default", border: "1px solid var(--border)", background: "transparent", opacity: canUndo ? 1 : 0.5 }}>Undo</button>
            <button onClick={duplicateSelected} disabled={!selectedClipId} title="Duplicate the selected clip" style={{ ...chip, cursor: selectedClipId ? "pointer" : "default", border: "1px solid var(--border)", background: "transparent", opacity: selectedClipId ? 1 : 0.5 }}>Duplicate</button>
            <div style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 11 }}>Drag onto a + between clips:</span>
            {TRANSITIONS.filter((t) => t.id !== "cut").map((t) => (
              <div key={t.id} draggable onDragStart={(e) => onChipDragStart(e, t.id)} onDragEnd={() => (dragTransition.current = null)} style={chip}>{t.label}</div>
            ))}
          </div>

          <div className="row" style={{ height: 38, flexShrink: 0, padding: "0 12px", borderBottom: "1px solid var(--border)", gap: 8 }}>
            <span className="muted" style={{ fontSize: 11 }}>Effects: drag onto the Effects lane</span>
            {FX_LIST.map((x) => (
              <div key={x.id} draggable onDragStart={(e) => { dragEffect.current = x.id; dragTransition.current = null; dragClipId.current = null; e.dataTransfer.setData("text/effect", x.id); e.dataTransfer.effectAllowed = "copy"; }} onDragEnd={() => (dragEffect.current = null)} style={chip}>{x.label}</div>
            ))}
            <div style={{ flex: 1 }} />
            {selectedEffect && (
              <>
                <span style={{ fontSize: 11, color: "#c4c4cc" }}>{FX_LIST.find((x) => x.id === selectedEffect.type)?.label} · {(selectedEffect.durationMs / 1000).toFixed(2)}s · Strength</span>
                <input type="range" min={10} max={100} step={5} value={selectedEffect.strength} onChange={(e) => { const v = Number(e.target.value); const next = fxRef.current.map((x) => (x.id === selectedEffect.id ? { ...x, strength: v } : x)); fxRef.current = next; setProject((p) => ({ ...p, effects: next })); }} onMouseUp={() => patch({ effects: fxRef.current })} onTouchEnd={() => patch({ effects: fxRef.current })} onKeyUp={() => patch({ effects: fxRef.current })} style={{ width: 110, padding: 0, accentColor: "var(--accent)" }} />
                <button onClick={() => { saveEffects(fxRef.current.filter((x) => x.id !== selectedEffect.id)); setSelectedEffectId(null); }} style={{ ...chip, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}>Remove</button>
              </>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <div style={{ width: 84, flexShrink: 0, borderRight: "1px solid var(--border)", fontSize: 11, color: "#c4c4cc" }}>
              <div style={{ height: 24 }} />
              <div style={{ height: 64, display: "flex", alignItems: "center", padding: "0 10px", borderTop: "1px solid var(--border)" }}>Video</div>
              <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 10px", borderTop: "1px solid var(--border)" }}>Effects</div>
              <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 10px", borderTop: "1px solid var(--border)" }}>Captions</div>
              <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 10px", borderTop: "1px solid var(--border)" }}>Voice</div>
              <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 10px", borderTop: "1px solid var(--border)" }}>Music</div>
            </div>

            <div ref={tracksRef} style={{ flex: 1, minWidth: 0, position: "relative", margin: "0 14px" }}>
              {/* ruler */}
              <div onMouseDown={seekFromEvent} style={{ height: 24, position: "relative", cursor: "pointer", fontSize: 10, color: "var(--muted)" }}>
                {ticks.map((t) => (
                  <span key={t} style={{ position: "absolute", left: `${pct(t)}%`, top: 6, borderLeft: "1px solid var(--border)", paddingLeft: 3 }}>{fmtTime(t)}</span>
                ))}
              </div>

              {/* video lane */}
              <div onMouseDown={(e) => { if (e.target !== e.currentTarget) return; seekFromEvent(e); setSelectedClipId(null); setSelectedCaptionId(null); setOpenJoin(null); }} style={{ height: 64, position: "relative", borderTop: "1px solid var(--border)" }}>
                {!placed.length && <span className="muted" style={{ position: "absolute", left: 4, top: 22, fontSize: 11 }}>Add clips from the Footage tab</span>}
                {placed.map((p) => {
                  const sel = p.clip.id === selectedClipId;
                  return (
                    <div
                      key={p.clip.id}
                      draggable
                      onDragStart={(e) => (trimming.current ? e.preventDefault() : onClipDragStart(e, p.clip.id))}
                      onDragOver={(e) => onClipDragOver(e, p.clip.id)}
                      onDrop={onClipDrop}
                      onClick={() => {
                        setSelectedCaptionId(null);
                        setSelectedClipId(sel ? null : p.clip.id);
                      }}
                      title={p.clip.source === "fal" ? "AI clip" : `Pexels · ${p.clip.pexelsAuthor}`}
                      style={{ position: "absolute", left: `${pct(p.startMs)}%`, width: `calc(${pct(p.endMs - p.startMs)}% - 2px)`, top: 6, bottom: 6, borderRadius: 6, overflow: "hidden", cursor: "grab", boxShadow: sel ? "0 0 0 2px var(--accent)" : "0 0 0 1px var(--border)", background: p.clip.source === "fal" ? "#4a3324" : "#2f4a3a" }}
                    >
                      {p.clip.pexelsThumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.clip.pexelsThumbnail} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                      ) : (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={p.clip.pexelsUrl} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85, pointerEvents: "none" }} />
                      )}
                      <span style={{ position: "absolute", left: 5, bottom: 3, fontSize: 10, color: "#fff", textShadow: "0 0 3px #000" }}>
                        {p.clip.source === "fal" ? "AI · " : ""}{(p.clip.durationMs / 1000).toFixed(1)}s
                      </span>
                      <div onMouseDown={(e) => startEdgeTrim(e, p.clip, "left")} title="Drag to trim the start" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 9, cursor: "ew-resize", background: sel ? "var(--accent)" : "rgba(255,255,255,0.25)", opacity: sel ? 0.9 : 0.6, zIndex: 3 }} />
                      <div onMouseDown={(e) => startEdgeTrim(e, p.clip, "right")} title="Drag to trim the end" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 9, cursor: "ew-resize", background: sel ? "var(--accent)" : "rgba(255,255,255,0.25)", opacity: sel ? 0.9 : 0.6, zIndex: 3 }} />
                    </div>
                  );
                })}
                {/* joins between clips */}
                {placed.slice(1).map((p) => {
                  const t = p.clip.transitionIn;
                  return (
                    <div
                      key={`join-${p.clip.id}`}
                      onDragOver={(e) => {
                        if (dragTransition.current) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const type = dragTransition.current ?? (e.dataTransfer.getData("text/plain") as TransitionType);
                        dragTransition.current = null;
                        if (TRANSITIONS.some((x) => x.id === type)) setTransition(p.clip.id, type);
                      }}
                      style={{ position: "absolute", left: `${pct(p.startMs)}%`, top: 0, bottom: 0, width: 30, transform: "translateX(-50%)", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenJoin(openJoin === p.clip.id ? null : p.clip.id);
                        }}
                        aria-label="Transition between clips"
                        title="Add a transition"
                        style={{ minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, border: t === "cut" ? "1px dashed #5a5a62" : "1px solid var(--accent)", background: "#121214", color: t === "cut" ? "#c4c4cc" : "#fff", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {transitionShort[t]}
                      </button>
                      {openJoin === p.clip.id && (
                        <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 4, background: "#1b1b1f", border: "1px solid var(--border)", borderRadius: 8, padding: 4, display: "flex", flexDirection: "column", minWidth: 120, zIndex: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                          {TRANSITIONS.map((x) => (
                            <button key={x.id} onClick={() => setTransition(p.clip.id, x.id)} style={{ textAlign: "left", background: x.id === t ? "var(--border)" : "none", border: 0, color: "var(--text)", padding: "6px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                              {x.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* effects lane */}
              <div
                onMouseDown={(e) => { if (e.target !== e.currentTarget) return; seekFromEvent(e); setSelectedEffectId(null); }}
                onDragOver={(e) => { if (dragEffect.current) e.preventDefault(); }}
                onDrop={dropEffect}
                style={{ height: 44, position: "relative", borderTop: "1px solid var(--border)" }}
              >
                {!project.effects.length && (
                  <span className="muted" style={{ position: "absolute", left: 4, top: 14, fontSize: 11, pointerEvents: "none" }}>Drop an effect here</span>
                )}
                {project.effects.map((x) => {
                  const sel = x.id === selectedEffectId;
                  const label = FX_LIST.find((f) => f.id === x.type)?.label ?? x.type;
                  return (
                    <div
                      key={x.id}
                      onMouseDown={(e) => startEffectDrag(e, x, "move")}
                      title={`${label}: drag to move, pull the edges to change the length`}
                      style={{ position: "absolute", left: `${pct(x.startMs)}%`, width: `calc(${pct(x.durationMs)}% - 2px)`, top: 6, bottom: 6, background: "linear-gradient(90deg,#7a3ea8,#a8437a)", borderRadius: 5, boxShadow: sel ? "0 0 0 2px var(--accent)" : "0 0 0 1px var(--border)", cursor: "grab", overflow: "hidden", fontSize: 10, color: "#fff", display: "flex", alignItems: "center", padding: "0 10px", whiteSpace: "nowrap", userSelect: "none" }}
                    >
                      {label}
                      <div onMouseDown={(e) => startEffectDrag(e, x, "left")} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize", background: "rgba(255,255,255,0.35)" }} />
                      <div onMouseDown={(e) => startEffectDrag(e, x, "right")} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize", background: "rgba(255,255,255,0.35)" }} />
                    </div>
                  );
                })}
              </div>

              {/* captions lane */}
              <div onMouseDown={(e) => e.target === e.currentTarget && seekFromEvent(e)} style={{ height: 44, position: "relative", borderTop: "1px solid var(--border)" }}>
                {!project.captions.length && (
                  <span className="muted" style={{ position: "absolute", left: 4, top: 14, fontSize: 11, pointerEvents: "none" }}>
                    {audioUrl ? "No captions yet: use Add captions in the right panel" : "Captions appear when you generate a voiceover (Claude tab)"}
                  </span>
                )}
                {project.captions.map((c) => {
                  const sel = c.id === selectedCaptionId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedClipId(null);
                        setSelectedCaptionId(sel ? null : c.id);
                        seek(c.startMs);
                      }}
                      title={c.text}
                      style={{ position: "absolute", left: `${pct(c.startMs)}%`, width: `calc(${pct(c.endMs - c.startMs)}% - 2px)`, top: 8, bottom: 8, background: "#22262e", border: 0, boxShadow: sel ? "0 0 0 2px var(--accent)" : "none", borderRadius: 4, padding: "0 5px", fontSize: 10, color: "#b8c2d6", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", textAlign: "left", cursor: "pointer" }}
                    >
                      {c.text}
                    </button>
                  );
                })}
              </div>

              {/* voice lane */}
              <div onMouseDown={seekFromEvent} style={{ height: 44, position: "relative", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                {audioUrl && audioMs > 0 ? (
                  <div style={{ position: "absolute", left: 0, width: `${pct(audioMs)}%`, top: 10, bottom: 10, background: "repeating-linear-gradient(90deg,#3d5a6e 0 2px,transparent 2px 5px)", borderRadius: 4 }} />
                ) : (
                  <span className="muted" style={{ position: "absolute", left: 4, top: 14, fontSize: 11 }}>No voiceover yet</span>
                )}
              </div>

              {/* music lane */}
              <div onMouseDown={seekFromEvent} style={{ height: 44, position: "relative", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                {project.musicUrl && totalMs > 0 ? (
                  <div style={{ position: "absolute", left: 0, right: 0, top: 10, bottom: 10, background: "repeating-linear-gradient(90deg,#5e4a7a 0 2px,transparent 2px 6px)", borderRadius: 4, overflow: "hidden" }}>
                    <span style={{ position: "absolute", left: 6, top: 3, fontSize: 10, color: "#fff", textShadow: "0 0 3px #000" }}>{project.musicName || "Music"}</span>
                  </div>
                ) : (
                  <span className="muted" style={{ position: "absolute", left: 4, top: 14, fontSize: 11 }}>No music yet (add one in the right panel)</span>
                )}
              </div>

              {/* playhead */}
              {totalMs > 0 && (
                <div style={{ position: "absolute", left: `${pct(timeMs)}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: "var(--accent)", pointerEvents: "none", zIndex: 30 }}>
                  <div style={{ position: "absolute", top: 0, left: -4, width: 10, height: 10, borderRadius: 2, background: "var(--accent)" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
