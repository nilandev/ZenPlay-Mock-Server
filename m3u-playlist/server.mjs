// A local, fake M3U playlist (with an XMLTV guide) for demos and store screenshots.
// No dependencies: `node server.mjs` (Node 20+). See README.md.
//
// Shares the invented catalogue, artwork and rendered demo clip with the
// Xtream mock in ../xtream-playlist, so both sources show the same content.

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, programmesFor } from "../xtream-playlist/catalog.mjs";
import { backdropSvg, logoSvg, posterSvg } from "../xtream-playlist/artwork.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? "0.0.0.0";
/** Optional `?token=` the playlist and guide URLs must carry — off by default, like most plain M3U links. */
const TOKEN = process.env.MOCK_TOKEN ?? "";

const { vodCategories, movies, seriesCategories, series, liveCategories, channels } = catalog;
const movieById = new Map(movies.map((m) => [String(m.id), m]));
const seriesById = new Map(series.map((s) => [String(s.id), s]));
const channelById = new Map(channels.map((c) => [String(c.id), c]));
const categoryName = new Map([...vodCategories, ...seriesCategories, ...liveCategories].map((c) => [c.category_id, c.category_name]));

const now = () => Math.floor(Date.now() / 1000);

// Demo video, rendered once by ../xtream-playlist/make-video.swift (see README) — absent until then.
const MEDIA = process.env.MOCK_MEDIA ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../xtream-playlist/media");
const MOVIE_FILE = path.join(MEDIA, "movie.mp4");
const HLS_DIR = path.join(MEDIA, "hls");
const hasVideo = () => existsSync(MOVIE_FILE) && existsSync(path.join(HLS_DIR, "segments.json"));

// --- Responses -----------------------------------------------------------------

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": type.startsWith("image/") ? "public, max-age=86400" : "no-store",
  });
  res.end(body);
}

const svg = (res, body) => send(res, 200, body, "image/svg+xml");

/** Absolute URLs built from the request's own Host, so the same playlist works on localhost, a LAN IP or the simulator. */
function baseOf(req) {
  return `http://${req.headers.host ?? `localhost:${PORT}`}`;
}

const tokenQuery = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "";

// --- Playlist ------------------------------------------------------------------

/**
 * The apps guess each entry's kind from its URL and group-title alone: "series"
 * or SxxEyy means series, "movie"/"vod"/.mp4 means movie, anything else is live.
 * So live URLs carry only a numeric id, and the live "Movies" group is renamed —
 * left as is, its channels would all be filed as films.
 */
const LIVE_GROUP_NAMES = { Movies: "Cinema" };
const liveGroup = (c) => LIVE_GROUP_NAMES[c.group] ?? c.group;

/** Attribute values can't contain a double quote — M3U has no escaping. */
const attr = (text) => String(text).replace(/"/g, "'");

function extinf(attrs, name, duration = -1) {
  const list = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${attr(value)}"`)
    .join(" ");
  return `#EXTINF:${duration} ${list},${name}`;
}

function liveEntries(base) {
  return channels.flatMap((c) => [
    extinf(
      {
        "tvg-id": c.epgId,
        "tvg-name": c.name,
        "tvg-chno": c.num,
        "tvg-logo": `${base}/art/logo/${c.id}.svg`,
        "group-title": liveGroup(c),
        ...(c.archive ? { catchup: "default", "catchup-days": 7, "catchup-source": `${base}/catchup/${c.id}.mp4?utc={utc}&lutc={lutc}` } : {}),
      },
      c.name,
    ),
    `${base}/live/${c.id}.m3u8`,
  ]);
}

function movieEntries(base) {
  return movies.flatMap((m) => [
    extinf(
      {
        "tvg-id": `movie-${m.id}`,
        "tvg-name": `${m.title} (${m.year})`,
        "tvg-logo": `${base}/art/poster/movie/${m.id}.svg`,
        "group-title": categoryName.get(m.categoryId),
      },
      `${m.title} (${m.year})`,
      m.durationSecs,
    ),
    `${base}/movie/${m.id}.mp4`,
  ]);
}

function seriesEntries(base) {
  return series.flatMap((s) =>
    Object.values(s.seasons).flatMap((episodes) =>
      episodes.flatMap((ep) => {
        const name = `${s.title} S${String(ep.season).padStart(2, "0")}E${String(ep.episode_num).padStart(2, "0")}`;
        return [
          extinf(
            {
              "tvg-id": `episode-${ep.id}`,
              "tvg-name": name,
              "tvg-logo": `${base}/art/poster/series/${s.id}.svg`,
              "group-title": categoryName.get(s.categoryId),
            },
            name,
            ep.durationSecs,
          ),
          `${base}/series/${s.id}/${ep.id}.mp4`,
        ];
      }),
    ),
  );
}

/** `which` picks a slice of the catalogue: all, live, movies or series. */
function playlist(req, which) {
  const base = baseOf(req);
  const guide = `${base}/epg.xml${tokenQuery}`;
  const lines = [`#EXTM3U url-tvg="${guide}" x-tvg-url="${guide}"`];
  if (which === "all" || which === "live") lines.push(...liveEntries(base));
  if (which === "all" || which === "movies") lines.push(...movieEntries(base));
  if (which === "all" || which === "series") lines.push(...seriesEntries(base));
  return lines.join("\n") + "\n";
}

// --- Guide (XMLTV) ---------------------------------------------------------------

function xmlEscape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function xmltvTime(seconds) {
  return new Date(seconds * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
}

function xmltv(req) {
  const base = baseOf(req);
  const t = now();
  const from = t - 6 * 3600;
  const to = t + 3 * 86400;
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="zenplay-mock-m3u">'];
  for (const c of channels) {
    parts.push(`<channel id="${xmlEscape(c.epgId)}"><display-name>${xmlEscape(c.name)}</display-name><icon src="${base}/art/logo/${c.id}.svg"/></channel>`);
  }
  for (const c of channels) {
    for (const p of programmesFor(c, from, to)) {
      parts.push(
        `<programme start="${xmltvTime(p.start)}" stop="${xmltvTime(p.stop)}" channel="${xmlEscape(c.epgId)}"><title lang="en">${xmlEscape(p.title)}</title><desc lang="en">${xmlEscape(p.description)}</desc><category lang="en">${xmlEscape(p.category)}</category></programme>`,
      );
    }
  }
  parts.push("</tv>");
  return parts.join("\n");
}

// --- Artwork -------------------------------------------------------------------

function artwork(res, pathname) {
  const [, , kind, a, b] = pathname.replace(/\.svg$/, "").split("/");
  if (kind === "poster") {
    const item = a === "movie" ? movieById.get(b) : seriesById.get(b);
    if (item) return svg(res, posterSvg({ title: item.title, year: item.year, genre: item.genre, palette: item.palette }));
  }
  if (kind === "backdrop") {
    const item = a === "movie" ? movieById.get(b) : seriesById.get(b);
    if (item) return svg(res, backdropSvg({ title: item.title, palette: item.palette }));
  }
  if (kind === "logo") {
    const c = channelById.get(a);
    if (c) return svg(res, logoSvg({ name: c.name, palette: c.palette }));
  }
  return send(res, 404, "Not found", "text/plain");
}

// --- Video -------------------------------------------------------------------------

const NO_VIDEO = "No demo video yet: run `npm run make-video` in xtream-playlist/ (see README).";

/** Serves a file with HTTP Range support — the player seeks and starts playback with range requests. */
function sendFile(req, res, file, type) {
  const size = statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (!range) {
    res.writeHead(200, { ...headers, "Content-Length": size });
    return createReadStream(file).pipe(res);
  }
  const start = range[1] ? Number(range[1]) : size - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
  createReadStream(file, { start, end }).pipe(res);
}

/**
 * A never-ending live playlist: the rendered segments played on a loop,
 * clocked to wall time so every channel is "live" at the same point. Each
 * wrap back to the first segment is marked as a discontinuity, since its
 * timestamps start again from zero.
 */
function livePlaylist() {
  const { durations } = JSON.parse(readFileSync(path.join(HLS_DIR, "segments.json"), "utf8"));
  const count = durations.length;
  const segment = Math.max(...durations);
  const window = 6;
  const current = Math.floor(Date.now() / 1000 / segment);
  const first = current - window + 1;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${Math.ceil(segment)}`,
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor((first - 1) / count)}`,
    '#EXT-X-MAP:URI="/hls/init.mp4"',
  ];
  for (let g = first; g <= current; g++) {
    const index = g % count;
    if (index === 0) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${durations[index].toFixed(3)},`, `/hls/seg${index}.m4s`);
  }
  return lines.join("\n") + "\n";
}

function video(req, res, pathname) {
  if (!hasVideo()) return send(res, 404, NO_VIDEO, "text/plain");
  const live = /^\/live\/(\d+)\.m3u8$/.exec(pathname);
  if (live) return channelById.has(live[1]) ? send(res, 200, livePlaylist(), "application/vnd.apple.mpegurl") : send(res, 404, "Not found", "text/plain");
  const hls = /^\/hls\/(init\.mp4|seg\d+\.m4s)$/.exec(pathname);
  if (hls) {
    const file = path.join(HLS_DIR, hls[1]);
    return existsSync(file) ? sendFile(req, res, file, "video/mp4") : send(res, 404, "Not found", "text/plain");
  }
  // Films, episodes and catch-up all play the same clip.
  if (/^\/(movie\/\d+|series\/\d+\/\d+|catchup\/\d+)\.mp4$/.test(pathname)) return sendFile(req, res, MOVIE_FILE, "video/mp4");
  return send(res, 404, "No stream here.", "text/plain");
}

// --- Server --------------------------------------------------------------------

const PLAYLISTS = { "/playlist.m3u": "all", "/playlist.m3u8": "all", "/live.m3u": "live", "/movies.m3u": "movies", "/series.m3u": "series" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  const which = PLAYLISTS[url.pathname];
  if (which || url.pathname === "/epg.xml") {
    if (TOKEN && url.searchParams.get("token") !== TOKEN) return send(res, 401, "Unauthorized", "text/plain");
    if (which) return send(res, 200, playlist(req, which), "audio/x-mpegurl; charset=utf-8");
    return send(res, 200, xmltv(req), "application/xml; charset=utf-8");
  }
  if (url.pathname.startsWith("/art/")) return artwork(res, url.pathname);
  // /live/, /movie/, /series/, /catchup/, /hls/: the rendered demo clip.
  return video(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  const episodes = series.reduce((n, s) => n + Object.values(s.seasons).flat().length, 0);
  console.log(`ZenPlay mock M3U server
  Channels ${channels.length} · Movies ${movies.length} · Series ${series.length} (${episodes} episodes)

  Playlist URL:  http://localhost:${PORT}/playlist.m3u${tokenQuery}${lan ? `   (TV on your network: http://${lan}:${PORT}/playlist.m3u${tokenQuery})` : ""}
  Guide URL:     http://localhost:${PORT}/epg.xml${tokenQuery}
  Also:          /live.m3u  /movies.m3u  /series.m3u

  Video:         ${hasVideo() ? "demo clip ready (movies, episodes, catch-up and live)" : NO_VIDEO}`);
});
