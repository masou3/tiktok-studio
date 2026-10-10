export type Clip = {
  id: string;
  projectId: string;
  order: number;
  durationMs: number;
  trimStartMs: number;
  pexelsVideoId: number;
  pexelsUrl: string;
  pexelsThumbnail: string;
  pexelsAuthor: string;
  pexelsWidth: number;
  pexelsHeight: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type Project = {
  id: string;
  title: string;
  aspect: "9:16";
  fps: 30;
  width: 1080;
  height: 1920;
  durationMs: number;
  status: "draft" | "rendering" | "exported";
  aiDisclosure: boolean;
  hashtags: string[];
  clips: Clip[];
  voiceoverScript: string;
  voiceoverUrl: string;
  createdAt: string;
  updatedAt: string;
};
