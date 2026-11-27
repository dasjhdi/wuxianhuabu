import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { aiLabelFilter, cleanText, fontFile, splitLines } from "./text";

const exec = promisify(execFile);
const TRANSITION_DURATION = 0.6;

export type Transition = "none" | "fade" | "slide";

async function run(args: string[]) {
  const { ffmpeg } = await prepareWorkspaceFfmpeg();
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

export async function probeDuration(file: string) {
  const { ffprobe } = await prepareWorkspaceFfmpeg();
  const { stdout } = await exec(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { maxBuffer: 1024 * 1024 });
  const value = Number(String(stdout).trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function normalize(source: string, target: string, width: number, height: number) {
  await run([
    "-i", source,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
    "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    target,
  ]);
}

async function stitchConcat(inputs: string[], output: string, width: number, height: number) {
  const filters = inputs.map((_, index) => `[${index}:v]scale=${width}:${height}:setsar=1,fps=30[v${index}]`);
  filters.push(`${inputs.map((_, index) => `[v${index}]`).join("")}concat=n=${inputs.length}:v=1:a=0[out]`);
  await run([
    ...inputs.flatMap(file => ["-i", file]),
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    output,
  ]);
}

async function stitchTransition(inputs: string[], output: string, transition: Transition, durations: number[]) {
  if (!inputs.length) throw new Error("没有可拼接的视频片段");
  if (inputs.length === 1) {
    await copyFile(inputs[0], output);
    return;
  }
  const filter: string[] = [];
  let offset = durations[0] - TRANSITION_DURATION;
  let last = "[0:v]";
  for (let index = 1; index < inputs.length; index += 1) {
    const label = index === inputs.length - 1 ? "[out]" : `[x${index}]`;
    filter.push(`${last}[${index}:v]xfade=transition=${transition === "slide" ? "slideleft" : "fade"}:duration=${TRANSITION_DURATION}:offset=${Math.max(0, offset).toFixed(3)}${label}`);
    last = label;
    offset += durations[index] - TRANSITION_DURATION;
  }
  await run([
    ...inputs.flatMap(file => ["-i", file]),
    "-filter_complex", filter.join(";"),
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    output,
  ]);
}

async function muxBgm(video: string, bgm: string, output: string) {
  await run([
    "-stream_loop", "-1", "-i", bgm,
    "-i", video,
    "-map", "1:v:0", "-map", "0:a:0",
    "-filter:a", "volume=0.28",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-shortest", "-movflags", "+faststart",
    output,
  ]);
}

async function burnSubtitles(video: string, output: string, subtitles: string[], starts: number[], durations: number[], width: number, height: number, label = false) {
  const font = fontFile();
  if (!font) return false;
  const fontPath = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const fontSize = Math.max(28, Math.round(height / 26));
  const filters: string[] = [];
  subtitles.slice(0, 3).forEach((raw, index) => {
    const text = cleanText(raw);
    if (!text) return;
    const start = Math.max(0, starts[index] ?? 0) + 0.25;
    const end = (starts[index] ?? 0) + (durations[index] ?? 5) - 0.3;
    if (end <= start) return;
    const lines = splitLines(text);
    lines.forEach((line, lineIndex) => {
      const y = Math.round(height * 0.74) + lineIndex * Math.round(fontSize * 1.35);
      filters.push(
        `drawtext=fontfile='${fontPath}':text='${line}':fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.42:boxborderw=${Math.round(fontSize * 0.32)}:x=(w-text_w)/2:y=${y}:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`,
      );
    });
  });
  if (label) {
    const mark = aiLabelFilter(width, height);
    if (mark) filters.push(mark);
  }
  if (!filters.length) return false;
  await run([
    "-i", video,
    "-vf", filters.join(","),
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    ...(label ? ["-metadata", "comment=AI-generated content"] : []),
    "-movflags", "+faststart",
    output,
  ]);
  return true;
}

export interface PostProcessInput {
  segments: string[];
  directory: string;
  width: number;
  height: number;
  transition: Transition;
  bgmPath?: string;
  subtitles: string[];
  aiLabel?: boolean;
  output: string;
}

async function normalizeWithAudio(source: string, target: string, width: number, height: number) {
  await run([
    "-i", source,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    target,
  ]);
}

export async function finishAvatarVideo(input: {
  video: string;
  output: string;
  width: number;
  height: number;
  subtitles: string[];
  duration: number;
  aiLabel?: boolean;
}) {
  const normalized = join(input.output.replace(/[^\\/]+$/, ""), "avatar-normalized.mp4");
  await normalizeWithAudio(input.video, normalized, input.width, input.height);
  const total = input.duration || (await probeDuration(normalized));
  const withSubtitles = input.subtitles.length > 0 && total > 0;
  if (!withSubtitles && !input.aiLabel) {
    await copyFile(normalized, input.output);
    return false;
  }
  const subtitles = withSubtitles ? input.subtitles : [];
  const per = subtitles.length ? total / subtitles.length : total;
  const starts = subtitles.map((_, index) => index * per);
  const durations = subtitles.map(() => per);
  return burnSubtitles(normalized, input.output, subtitles, starts, durations, input.width, input.height, input.aiLabel === true);
}

export async function burnVideoLabel(video: string, output: string, width: number, height: number) {
  return burnSubtitles(video, output, [], [], [], width, height, true);
}

export async function postProcessVideo(input: PostProcessInput) {
  const warnings: string[] = [];
  const normalized: string[] = [];
  const durations: number[] = [];
  for (let index = 0; index < input.segments.length; index += 1) {
    const target = join(input.directory, `normalized-${index + 1}.mp4`);
    await normalize(input.segments[index], target, input.width, input.height);
    normalized.push(target);
    durations.push(await probeDuration(target));
  }

  const stitched = join(input.directory, input.transition === "none" ? "stitched.mp4" : "stitched-transition.mp4");
  if (input.transition === "none" || normalized.length === 1) await stitchConcat(normalized, stitched, input.width, input.height);
  else await stitchTransition(normalized, stitched, input.transition, durations);
  if (input.transition !== "none" && normalized.length > 1) warnings.push(input.transition === "slide" ? "已添加滑动转场" : "已添加淡入淡出转场");

  const starts: number[] = [];
  let cursor = 0;
  for (let index = 0; index < durations.length; index += 1) {
    starts.push(cursor);
    cursor += durations[index] - (index < durations.length - 1 && input.transition !== "none" ? TRANSITION_DURATION : 0);
  }

  let current = stitched;
  if (input.bgmPath) {
    const mixed = join(input.directory, "with-bgm.mp4");
    await muxBgm(current, input.bgmPath, mixed);
    current = mixed;
    warnings.push("已混合背景音乐");
  }

  if (input.subtitles.length || input.aiLabel) {
    const burned = await burnSubtitles(current, join(input.directory, "with-subtitles.mp4"), input.subtitles, starts, durations, input.width, input.height, input.aiLabel === true);
    if (burned) {
      current = join(input.directory, "with-subtitles.mp4");
      if (input.subtitles.length) warnings.push(`已烧录 ${Math.min(input.subtitles.length, durations.length)} 条卖点字幕`);
      if (input.aiLabel) warnings.push("已烧录「AI 生成」标识");
    } else {
      const skipped = [input.subtitles.length ? "字幕" : "", input.aiLabel ? "AI 标识" : ""].filter(Boolean).join("与");
      warnings.push(`未找到可用的中文字体，${skipped}已跳过`);
    }
  }

  if (current !== input.output) await copyFile(current, input.output);
  return warnings;
}
