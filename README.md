# Local WebRTC Webcam

Use an iPhone as an OBS webcam source on Ubuntu without a native iOS app or a media relay.

The iPhone opens a Safari camera page. Ubuntu opens a receiver page, or the clean OBS page in an OBS Browser Source. OBS Virtual Camera can then expose that source to video-call apps.

## Goals

- Stream iPhone camera video to Ubuntu with WebRTC.
- Keep media local and peer-to-peer over the LAN or USB-tethered network.
- Use Cloudflare Workers only for hosting, pairing, QR generation, and WebRTC signaling.
- Provide an OBS-friendly `/obs` mode that renders only the video.
- Show actual camera and receiver properties instead of assuming fixed limits.
- Make direct-path verification visible through ICE candidate and WebRTC stats.
- Fail rather than use STUN, TURN, a relay, SFU, media server, Cloudflare Realtime, or Cloudflare Stream.

## Non-goals

- No native iOS app.
- No DroidCam, Iriun, Camo, or other webcam app dependency.
- No multi-viewer broadcast mode.
- No remote internet streaming of camera media.
- No fallback to relay infrastructure when direct local WebRTC cannot connect.

## Design

- `public/index.html` is a single browser app with receiver, camera, and OBS modes.
- `src/index.ts` is a Cloudflare Worker that serves app routes, creates rooms, generates QR codes, and upgrades signaling WebSockets.
- `SignalingRoom` is a Durable Object keyed by room id. It forwards only SDP/ICE JSON between one `receiver` and one `camera`.
- WebRTC is configured with `iceServers: []`. There is no STUN or TURN configuration.
- ICE candidates with relay or server-reflexive candidate types are rejected.
- The camera requests 4K/30 as an ideal constraint, then reports the actual Safari track settings.
- Sender tuning uses balanced adaptation so WebRTC can lower quality temporarily instead of building latency during short network dips.
- The receiver reports incoming resolution/FPS, selected candidate path, inbound RTP stats, video element state, and a sampled rendered frame.

## Usage

```sh
pnpm run dev
```

For iPhone Safari camera access during local development, use Wrangler's quick tunnel from the dev UI by pressing `t`.

Open:

- `/receiver` on Ubuntu to create a room and show the iPhone QR/link.
- `/camera?mode=camera&room=...` on iPhone Safari.
- `/obs?mode=obs&room=...` in OBS Browser Source for the clean video-only receiver.
