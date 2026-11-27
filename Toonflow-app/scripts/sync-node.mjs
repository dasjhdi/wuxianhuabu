// ACT: 构建产物输出到 build/nodes/，而运行时加载的是 data/nodes/。
// 上游没有同步机制，历史上一度靠手工复制，导致改完代码界面不变。
// 本脚本把指定节点的 UMD 与声明文件同步到 data/nodes/，供 build / watch 后调用。
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , name] = process.argv;
if (!name || !/^[a-z][a-zA-Z0-9]*$/.test(name)) {
  console.error("用法：node sync-node.mjs <nodeName>");
  process.exit(1);
}

const source = resolve(root, "build/nodes", `${name}.umd.js`);
if (!existsSync(source)) {
  console.error(`找不到构建产物：${source}（先运行 vite build）`);
  process.exit(1);
}

const targetDirectory = resolve(root, "data/nodes");
mkdirSync(targetDirectory, { recursive: true });
copyFileSync(source, resolve(targetDirectory, `${name}.umd.js`));

for (const extension of ["d.ts", "json"]) {
  const declaration = resolve(root, "build/nodes", `${name}.${extension}`);
  if (existsSync(declaration)) copyFileSync(declaration, resolve(targetDirectory, `${name}.${extension}`));
}

console.log(`已同步 ${name}.umd.js → data/nodes/`);
