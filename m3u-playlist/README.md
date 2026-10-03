# Mock M3U playlist

A local, fake M3U playlist with an XMLTV guide, for running ZenPlay's
**M3U URL** source without a real IPTV subscription — for demos, development
and app-store screenshots.

It serves the same invented catalogue as the [Xtream mock](../xtream-playlist)
(it imports that folder's `catalog.mjs` and `artwork.mjs`), so titles,
channels, artwork and the TV guide match between the two sources. Everything
is invented and seeded, so every run serves exactly the same playlist.

## Run

```sh
cd m3u-playlist && npm start
```

No dependencies — Node 20+ only. It prints the URLs to use (and the ones for
a TV on your network):

| Field        | Value                                 |
| ------------ | ------------------------------------- |
| Playlist URL | `http://localhost:8788/playlist.m3u`  |
| Guide URL    | `http://localhost:8788/epg.xml`       |

Add it in ZenPlay as an **M3U URL** playlist. The playlist header carries
`url-tvg`, which the Kotlin app picks up on its own; on webOS, paste the
guide URL into the EPG field.

Options (environment variables): `PORT` (default `8788`, so it can run next
to the Xtream mock on `8787`), `HOST` (default `0.0.0.0`), `MOCK_TOKEN` (when
set, the playlist and guide require `?token=<value>` — handy for testing a
link that's been rejected) and `MOCK_MEDIA` (where the demo video lives;
default `../xtream-playlist/media`).

## What's in it

- `/playlist.m3u` (or `.m3u8`) — everything: ~55 live channels, ~120
  movies and every episode of ~60 series. `/live.m3u`, `/movies.m3u` and
  `/series.m3u` serve one kind each.
- Live entries carry `tvg-id`, `tvg-name`, `tvg-chno`, `tvg-logo` and
  `group-title`; News, Sports, Entertainment and Documentary channels add
  `catchup`/`catchup-days`/`catchup-source` attributes.
- Movies come as "Title (Year)"; episodes as "Show S01E02", one entry per
  episode, the way M3U providers list them.
- `/epg.xml` — the guide, 6 hours back to 3 days ahead, keyed by the
  channels' `tvg-id`.

ZenPlay sorts M3U entries into live, movies and series from the URL and
`group-title` only, so URLs are shaped to make that unambiguous:
`/live/<id>.m3u8`, `/movie/<id>.mp4`, `/series/<show>/<episode>.mp4`. For the
same reason the live "Movies" group is called **Cinema** here — a group title
containing "movie" would file those channels as films.

## Video

Pressing play uses the demo clip rendered for the Xtream mock. Render it once
(~1–2 minutes; needs the Xcode command line tools):

```sh
cd m3u-playlist && npm run make-video     # runs it in ../xtream-playlist
```

Films, episodes and catch-up play `movie.mp4` (with seeking); live channels
play the looping HLS stream. Without the video the playlist still loads and
play shows the player's error state.

## Files

- `server.mjs` — the HTTP server; builds the playlist and guide from
  `../xtream-playlist/catalog.mjs`.
