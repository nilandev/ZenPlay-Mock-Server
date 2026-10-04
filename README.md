# ZenPlay mock servers

Local, fake IPTV sources for running ZenPlay without a real subscription.
Everything they serve is invented, and the content is seeded, so every run is identical.

| Folder | Source type | Default URL |
| --- | --- | --- |
| [`xtream-playlist`](xtream-playlist) | Xtream Codes panel (login `demo` / `demo`) | `http://localhost:8787` |
| [`m3u-playlist`](m3u-playlist) | M3U playlist + XMLTV guide | `http://localhost:8788/playlist.m3u` |

## Run

Node 20+ only, no dependencies to install. From this folder:

```sh
pnpm mock          # both servers (same as pnpm start)
pnpm mock:xtream   # only the Xtream server
pnpm mock:m3u      # only the M3U server
```

`npm run …` works the same way. With both running, each log line is tagged
`[xtream]` or `[m3u]`. Ctrl+C stops everything, and if one server exits the
other is stopped too.

Environment variables (`PORT`, `HOST`, and the others in each folder's README)
pass through to the servers. With `pnpm mock`, `PORT` would apply to both, so set
it only when running one server.

`pnpm make-video` renders the demo clip both servers stream (needs the Xcode
command line tools); see [xtream-playlist/README.md](xtream-playlist/README.md).
