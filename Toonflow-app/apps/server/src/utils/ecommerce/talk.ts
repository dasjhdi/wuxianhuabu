import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { drawText, splitLines } from "./text";

const exec = promisify(execFile);

async function run(args: string[]) {
  const { ffmpeg } = await prepareWorkspaceFfmpeg();
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

export interface TalkRenderInput {
  portrait: string;
  audio: string;
  duration: number;
  width: number;
  height: number;
  subtitles: string[];
  output: string;
}

export async function renderTalkVideo(input: TalkRenderInput) {
  const { width, height } = input;
  const filters = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0006,1.07)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30[base]`,
  ];
  const texts: string[] = [];
  const items = input.subtitles.slice(0, 8);
  const per = input.duration / Math.max(1, items.length);
  items.forEach((raw, index) => {
    const size = Math.round(width / 22);
    splitLines(raw, 14, 2).forEach((line, lineIndex) => {
      const filter = drawText({
        text: line,
        x: "(w-text_w)/2",
        y: Math.round(height * 0.78) + lineIndex * Math.round(size * 1.35),
        size,
        color: "white",
        box: true,
        boxColor: "black@0.45",
        enable: `between(t,${(index * per + 0.2).toFixed(2)},${((index + 1) * per - 0.15).toFixed(2)})`,
      });
      if (filter) texts.push(filter);
    });
  });
  filters.push(texts.length ? `[base]${texts.join(",")}[out]` : `[base]null[out]`);

  await run([
    "-loop", "1", "-i", input.portrait,
    "-i", input.audio,
    "-filter_complex", filters.join(";"),
    "-map", "[out]", "-map", "1:a:0",
    "-t", String(input.duration),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest", "-movflags", "+faststart",
    input.output,
  ]);
}
