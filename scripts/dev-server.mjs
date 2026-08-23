#!/usr/bin/env node
/**
 * Zero-dependency static server for local development and tests.
 *
 * Mirrors the two production behaviours that matter for correctness:
 *   - `cleanUrls: true` from vercel.json, so `/about` serves `about.html`
 *   - HTTP Range responses, without which Chromium refuses to play the
 *     environment .mp4 files and every visual test sees a blank stage
 *
 * Usage: node scripts/dev-server.mjs [--port 4321] [--root .]
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const PORT = Number(arg("--port", process.env.PORT ?? 4321));
const ROOT = resolve(arg("--root", "."));

async function statFile(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/** Resolve a URL path to a file on disk, applying vercel.json cleanUrls. */
async function resolveTarget(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  // normalize() collapses ".."; the prefix check below rejects anything
  // that still escapes ROOT, so a crafted URL cannot read outside it.
  const candidate = normalize(join(ROOT, decoded));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;

  const direct = await statFile(candidate);
  if (direct) return { path: candidate, stats: direct };

  for (const suffix of ["index.html", ".html"]) {
    const withSuffix = decoded.endsWith("/")
      ? join(candidate, suffix)
      : candidate + suffix;
    if (suffix === "index.html" && !decoded.endsWith("/")) continue;
    const s = await statFile(withSuffix);
    if (s) return { path: withSuffix, stats: s };
  }
  return null;
}

/** Parse a single `bytes=` range. Returns null when absent or unsatisfiable. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  let start;
  let end;
  if (rawStart === "") {
    start = size - Number(rawEnd);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end) return { unsatisfiable: true };
  return { start, end };
}

const server = createServer(async (req, res) => {
  const target = await resolveTarget(req.url ?? "/");
  if (!target) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 Not Found\n");
    return;
  }

  const { path, stats } = target;
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  const base = {
    "content-type": type,
    "accept-ranges": "bytes",
    // Always revalidate: a cached module would silently mask an edit.
    "cache-control": "no-store",
  };

  const range = parseRange(req.headers.range, stats.size);
  if (range?.unsatisfiable) {
    res.writeHead(416, { ...base, "content-range": `bytes */${stats.size}` });
    res.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...base,
      "content-length": length,
      "content-range": `bytes ${range.start}-${range.end}/${stats.size}`,
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(path, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...base, "content-length": stats.size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(path).pipe(res);
});

server.listen(PORT, () => {
  console.log(
    `Rollerator dev server → http://localhost:${PORT}  (root ${ROOT})`,
  );
});
