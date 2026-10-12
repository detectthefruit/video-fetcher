# Video Fetcher

A small local web app that fetches direct video URLs through a streaming proxy and saves them to your device. YouTube watch, Shorts, live, and embed URLs open an embedded preview; YouTube video files are not downloaded by this tool.

## Run

Requires Node.js 18 or later. No packages to install.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use a different port.

The proxy only accepts HTTP(S) URLs that resolve to public addresses, rechecks redirect destinations, and streams the response instead of buffering the full video. The server binds to `127.0.0.1` and is intended for personal local use. Some video sites do not expose direct downloadable media URLs or require authentication; those sources are not supported.