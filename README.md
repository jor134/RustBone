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
   the project.
3. **Redeploy.** Vercel only injects env vars into builds created *after* the variable
   exists. Connecting a store does not retro-fit the running deployment. This is the most
   common reason the badge still reads `LOCAL ONLY`.
4. Open the site. Tap the storage badge on the menu for a full diagnosis, or hit
   `/api/kv?op=ping` directly — it lists every env var name the function can actually see
   and performs a live SET/GET round trip, so a wrong token shows up as an error rather
   than silently failing.

The proxy accepts `UPSTASH_REDIS_REST_URL/TOKEN`, `KV_REST_API_URL/TOKEN` and
`REDIS_REST_URL/TOKEN`, because Vercel injects different names depending on whether the
store came from the Upstash integration or the Marketplace KV path.

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

## WebRTC fast lane (BUILD 3)

Upstash is now only the introduction service. Peers find each other through presence
keys, swap exactly one offer and one answer through KV, then talk directly:

- **unreliable channel** — player transforms at 15 Hz, host beast state at 10 Hz. Stale
  frames are worthless, so no retransmits.
- **reliable channel** — hits, fort placements, demolitions, door state.

Once every peer is linked, the KV fast poll drops from 700 ms to 2.6 s and does nothing
but presence. Every direct path has a KV fallback: if `rtcSendTo` returns false the hit
goes back through the old queue, so a failed link degrades instead of breaking.

There is **no TURN server**. Symmetric NAT and some mobile carrier networks will fail to
establish a direct path; those sessions fall back to the KV lane automatically and the
`P2P n` counter in the HUD stays at zero. Adding TURN means a paid relay.

## Known gaps

- No in-headset HUD. VR gives you locomotion, controller-ray building and striking, but
  the vitals gauges are DOM and invisible in the headset.
- Host hand-off has a gap if the host quits mid-fight.
- Fresh water comes from coconuts only. Palms grow on the beach; that's the whole
  hydration loop and it's deliberate — it forces you off the high ground.
- Beasts break doors and walls but cannot open a barred door. Nothing on the island can,
  which makes a Door strictly better than a Doorway once you can afford the fibre.
