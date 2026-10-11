/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ffmpeg is a native binary: keep it out of the bundle and ship it with the export route.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/export": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/*", "./public/brand/*"],
  },
};
export default nextConfig;
