# Bifrost

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Ftnkuehne%2Fbifrost)

Use a phone as an OBS webcam source without a native phone app or a media relay.

The phone opens a browser camera page. The computer opens a receiver page, or the clean OBS page in an OBS Browser Source. OBS Virtual Camera can then expose that source to video-call apps.

## Goals

- Stream phone camera video to a computer with WebRTC.
- Keep media local and peer-to-peer over the LAN or USB-tethered network.
- Use Cloudflare Workers only for hosting, room creation, and WebRTC signaling.
- Provide an OBS-friendly `/obs` mode that renders only the video.
- Show actual camera and receiver properties instead of assuming fixed limits.
- Make direct-path verification visible through ICE candidate and WebRTC stats.
- Fail rather than use STUN, TURN, a relay, SFU, media server, Cloudflare Realtime, or Cloudflare Stream.

## Non-goals

- No native iOS or Android app.
- No DroidCam, Iriun, Camo, or other webcam app dependency.
- No multi-viewer broadcast mode.
- No remote internet streaming of camera media.
- No fallback to relay infrastructure when direct local WebRTC cannot connect.

## Design

- `src/client/index.html` is the Vite browser shell.
- `src/client/App.svelte` owns WebRTC orchestration and room state; `src/client/components/` contains the Svelte UI sections.
- Tailwind CSS is wired through the official Vite plugin. Utility classes live on Svelte markup; `src/client/app.css` only defines Tailwind theme tokens and small global browser defaults.
- `src/client/` also contains browser helper modules for signaling, QR generation, and WebRTC diagnostics.
- `src/index.ts` is a Cloudflare Worker that serves app routes, creates rooms, applies native rate limits, and upgrades signaling WebSockets.
- `SignalingRoom` is a Durable Object keyed by room id. It forwards only SDP/ICE JSON between one active receiver and one camera.
- `/obs` has receiver priority. `/` can preview the stream while OBS is absent, then stays available for pairing/status when OBS connects.
- WebRTC is configured with `iceServers: []`. There is no STUN or TURN configuration.
- ICE candidates with relay or server-reflexive candidate types are rejected.
- The camera requests 4K/30 as an ideal constraint, then reports the actual browser track settings.
- Sender tuning uses balanced adaptation so WebRTC can lower quality temporarily instead of building latency during short network dips.
- The receiver reports incoming resolution/FPS, selected candidate path, inbound RTP stats, video element state, and a sampled rendered frame.
- QR codes are generated in the browser, so there is no public QR-generation Worker endpoint.

## Usage

```sh
pnpm run build
pnpm run dev
```

For phone camera access during local development, use Wrangler's quick tunnel from the dev UI by pressing `t`.

Open:

- `/` on the computer to create a room, show the phone QR code, and preview the stream while OBS is absent.
- `/camera?room=...` on the phone browser.
- `/obs?room=...` in OBS Browser Source for the clean video-only receiver. When OBS connects, it becomes the active receiver without requiring the `/` page to close.

## Quality

```sh
pnpm run check
pnpm run lint
pnpm run format
pnpm run format:check
```
