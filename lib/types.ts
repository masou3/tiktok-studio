export type Clip = {
  id: string;
  projectId: string;
  order: number;
  durationMs: number;     // trimmed duration in ms
  trimStartMs: number;    // offset into source video
  // Pexels source
  pexelsVideoId: number;
  pexelsUrl: string;      // direct .mp4 URL (HD)
  pexelsThumbnail: string;
  pexelsAuthor: string;
  pexelsWidth: number;
  pexelsHeight: number;
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
  createdAt: string;
  updatedAt: string;
};
