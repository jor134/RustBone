# SALTBONE — BUILD 1

Mobile-first cel-shaded PvEvP shipwreck survival. Three.js r128, single-file client,
Upstash Redis for multiplayer state, WebXR for VR.

```
index.html      the entire game
api/kv.js       Vercel serverless proxy — holds the Upstash token
```

## Deploy

1. Commit both files to the repo root, push, let Vercel build.
2. Vercel dashboard → Storage → create an **Upstash Redis** database and connect it to
   the project. That injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Redeploy so the function picks up the env vars.
4. Open the site. The menu shows `STORAGE — UPSTASH KV` when the proxy is live. If it
   says `LOCAL ONLY`, the env vars aren't wired and the game runs single-player.

The client never sees the token. `api/kv.js` rejects any key that isn't `sb:{ROOM}:...`,
caps values at 220 KB, and forces a TTL so dead rooms expire.

## Architecture

**Two lanes.** Player transforms, hit events and host-authoritative beast state ride the
fast lane (700 ms). Fort structures ride the slow lane (3.2 s). Nothing polls faster than
it needs to, because every poll is an Upstash request.

**Keys**

| Key | Written by | Contents |
|---|---|---|
| `sb:{room}:world` | first joiner | island seed |
| `sb:{room}:p:{pid}` | each player | position, hp, outgoing hit queue |
| `sb:{room}:fort:{owner}` | fort owner | piece list, derelict timestamp |
| `sb:{room}:ai` | host only | beast transforms |

Each player writes only their own keys, so there are no write conflicts and no
last-write-wins losses on the fort. Owner is `T_{crew}` when a crew tag is set, otherwise
`P_{pid}` — that's how duo partners share one fort.

**Host** is the lowest live player id. The host simulates beasts and publishes them.
Clients apply beast damage optimistically and report it to the host, who reconciles.

**Death** writes the fort back with `derelict: <timestamp>`. Other clients render it
greyed and breakable. Five minutes later, whoever notices first deletes the key.

## Build grid

4 m cells, 3 m storeys. Every piece is `{t, gx, gz, lv, s, y}` — an integer record, which
is why forts serialize small enough to poll. Floors anchor to terrain and inherit their
neighbour's height so forts stay level on a slope.

## Known gaps in BUILD 1

- Player-vs-player hits and client-reported beast damage land through KV, so expect
  roughly one second of latency. WebRTC is the fix.
- No in-headset HUD. VR gives you locomotion, controller-ray building and striking, but
  the vitals gauges are DOM and invisible in the headset.
- Host hand-off has a gap if the host quits mid-fight.
- Fresh water comes from coconuts only. Palms grow on the beach; that's the whole
  hydration loop and it's deliberate — it forces you off the high ground.
