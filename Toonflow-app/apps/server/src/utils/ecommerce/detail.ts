import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { drawText, splitLines } from "./text";

const exec = promisify(execFile);

async function run(args: string[]) {
  const { ffmpeg } = await prepareWorkspaceFfmpeg();
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

export interface DetailModuleInput {
  background: string;
  foreground?: string;
  width: number;
  height: number;
  kind: "hero" | "point" | "footer";
  title?: string;
  subtitle?: string;
  index?: number;
  dark?: boolean;
  output: string;
}

export async function renderDetailModule(input: DetailModuleInput) {
  const color = input.dark ? "#1f2937" : "white";
  const box = !input.dark;
  const texts: string[] = [];
  const centerX = "(w-text_w)/2";

  if (input.kind === "hero") {
    const size = Math.round(input.width * 0.062);
    const lines = splitLines(input.title ?? "", 14, 2);
    let y = Math.round(input.height * 0.06);
    for (const line of lines) {
      const filter = drawText({ text: line, x: centerX, y, size, color, box, boxColor: "black@0.38" });
      if (filter) texts.push(filter);
      y += Math.round(size * 1.35);
    }
    if (input.subtitle) {
      const sub = drawText({ text: input.subtitle, x: centerX, y, size: Math.round(size * 0.5), color, box, boxColor: "black@0.3" });
      if (sub) texts.push(sub);
    }
  } else if (input.kind === "point") {
    const size = Math.round(input.width * 0.05);
    const lines = splitLines(input.title ?? "", 15, 2);
    let y = Math.round(input.height * 0.1);
    if (input.index) {
      const badge = drawText({ text: `0${input.index}`, x: Math.round(input.width * 0.07), y: Math.round(input.height * 0.035), size: Math.round(size * 1.1), color, box: false });
      if (badge) texts.push(badge);
    }
    for (const line of lines) {
      const filter = drawText({ text: line, x: centerX, y, size, color, box, boxColor: "black@0.38" });
      if (filter) texts.push(filter);
      y += Math.round(size * 1.32);
    }
  } else {
    const size = Math.round(input.width * 0.045);
    const lines = splitLines(input.title ?? "", 18, 2);
    let y = Math.round(input.height * 0.42);
    for (const line of lines) {
      const filter = drawText({ text: line, x: centerX, y, size, color, box, boxColor: "black@0.3" });
      if (filter) texts.push(filter);
      y += Math.round(size * 1.4);
    }
    if (input.subtitle) {
      const sub = drawText({ text: input.subtitle, x: centerX, y, size: Math.round(size * 0.6), color, box: false });
      if (sub) texts.push(sub);
    }
  }

  const filters: string[] = [];
  let source = "[0:v]";
  if (input.foreground) {
    const width = Math.round(input.width * (input.kind === "hero" ? 0.72 : 0.6));
    const gap = Math.round(input.height * (input.kind === "footer" ? 0.08 : 0.16));
    filters.push(`[1:v]scale=${width}:-1[fg]`);
    filters.push(`[0:v][fg]overlay=(W-w)/2:H-h-${gap}[base]`);
    source = "[base]";
  }
  if (texts.length) {
    filters.push(`${source}${texts.join(",")}[out]`);
    source = "[out]";
  } else if (source !== "[0:v]") {
    filters.push(`${source}null[out]`);
    source = "[out]";
  }

  const args = ["-i", input.background];
  if (input.foreground) args.push("-i", input.foreground);
  if (filters.length) args.push("-filter_complex", filters.join(";"), "-map", source);
  args.push("-frames:v", "1", input.output);
  await run(args);
}

export async function stackDetailImages(inputs: string[], output: string) {
  if (!inputs.length) throw new Error("没有可拼接的详情页模块");
  if (inputs.length === 1) return void await run(["-i", inputs[0], "-q:v", "2", output]);
  const filter = `${inputs.map((_, index) => `[${index}:v]`).join("")}vstack=inputs=${inputs.length}[out]`;
  await run([
    ...inputs.flatMap(file => ["-i", file]),
    "-filter_complex", filter,
    "-map", "[out]", "-q:v", "2",
    output,
  ]);
}
