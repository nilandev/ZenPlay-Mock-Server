// Starts one or both mock servers from the repo root, each in its own folder,
// with its output prefixed so the two logs can be told apart.
//
//   node run.mjs xtream m3u     (both)
//   node run.mjs xtream         (one)
//
// Ctrl+C stops them all; if one server exits, the other is stopped too.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const SERVERS = {
  xtream: { dir: "xtream-playlist", label: "xtream", color: 36 }, // cyan
  m3u: { dir: "m3u-playlist", label: "m3u   ", color: 35 }, // magenta
};

const names = process.argv.slice(2);
const unknown = names.filter((n) => !(n in SERVERS));
if (names.length === 0 || unknown.length > 0) {
  if (unknown.length > 0) console.error(`Unknown server: ${unknown.join(", ")}`);
  console.error(`Usage: node run.mjs <${Object.keys(SERVERS).join("|")}> [...]`);
  process.exit(1);
}

const children = [];
let stopping = false;

function prefixed(stream, out, label, color) {
  const tag = process.stdout.isTTY ? `\x1b[${color}m[${label}]\x1b[0m ` : `[${label}] `;
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) out.write(tag + line + "\n");
  });
  stream.on("end", () => { if (pending) out.write(tag + pending + "\n"); });
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const name of names) {
  const { dir, label, color } = SERVERS[name];
  // A single server keeps the terminal to itself, unprefixed, exactly as `npm start` in its folder would.
  const single = names.length === 1;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.join(ROOT, dir),
    env: process.env,
    stdio: single ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (!single) {
    prefixed(child.stdout, process.stdout, label, color);
    prefixed(child.stderr, process.stderr, label, color);
  }
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${label.trim()} server stopped (${signal ?? `exit code ${code}`})${names.length > 1 ? " — stopping the others" : ""}`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
