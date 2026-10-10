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
  createdAt: string;
  updatedAt: string;
};
