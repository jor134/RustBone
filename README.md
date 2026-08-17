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

## Installing as an app (PWA)

New files at the repo root: `manifest.webmanifest`, `sw.js`, `icon-192.png`,
`icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. All of them must sit
beside `index.html` at the root — `sw.js` in particular, because a service worker can
only control the paths at or below its own.

**iPhone / iPad.** Safari only. Chrome and Firefox on iOS cannot install web apps at all,
which is a WebKit restriction, not something the page can work around. The menu button
walks the player through Share → Add to Home Screen. Once installed it runs with no
browser chrome and honours the safe-area insets already in the CSS.

**Chrome / Edge (Android and desktop).** `beforeinstallprompt` is captured and the menu
button fires the real install prompt. Requires https, which Vercel provides.

**Anything else.** The "Play fullscreen" button uses the Fullscreen API. It does nothing
on iPhone Safari, which has no Fullscreen API — installing is the only route there.

### The service worker is deliberately network-first

A cache-first worker would pin every player to the build they installed and make your
future fixes invisible. Navigations hit the network first and only fall back to cache
when offline. `/api/*` is never intercepted, so multiplayer state can never come from a
cache. Bump `VERSION` in `sw.js` when you want to force old caches out.

## VR controls

The DOM HUD does not exist inside a headset, so VR gets its own console strapped to the
left controller: vitals, warmth, equipped tool, arrow count, day/time and the last
message, drawn to canvas textures.

Twelve buttons in three rows:

| | | | |
|---|---|---|---|
| `<TOOL` | `TOOL>` | `USE` | `BUILD` |
| `<PART` | `PART>` | `TURN` | `CRAFT` |
| `CHEST` | `HELP` | `SND` | `CLOSE` |

`CRAFT` and `CHEST` fold out panels beside your forearm. The chest panel is two columns —
what is stored and what you are carrying — with a `MOVE x1` / `MOVE ALL` switch at the
bottom. `HELP` shows the full control legend; it opens by itself the first time you enter
VR. `CLOSE` clears every panel at once.

Controllers bind by **reported handedness, not controller index**. The index is not
guaranteed to be left/right — on some runtimes 0 is simply whichever controller woke up
first — so the wrist console re-parents itself to whichever controller says it is the
left hand.

Point the right controller and pull the trigger. Pointing at the console presses it
instead of swinging, so you never chop a tree by accident while changing tools.

## Audio

Everything is synthesised with the Web Audio API at runtime — no sample files, so the
game stays one deployable page. Nothing is created until the first tap, because browsers
block audio before a user gesture.

**Ambience** is four filtered noise loops whose gains track the world: surf rises as you
approach the shore, wind rises on the ridge, insects fade in at night, and fire crackles
scale with your distance to the nearest firepit or your own torch.

**Music** is three crossfading drone beds — day (A minor), night (lower, darker), and
danger — plus a sparse plucked motif that only plays when you are not in trouble.

**Under 25 health** the danger bed takes over and a heartbeat starts, accelerating from
56 bpm at the threshold to 124 bpm as you approach death. The screen vignette pulses at
exactly the same rate, so the audio and the visual are the same warning.

Muted from the menu or the `Snd` button in game; the setting persists.

## Endgame

Three bosses, each awake only in its own hours. Positions are a pure function of time and
seed, so every client agrees on where they are without syncing a thing — only hits and
deaths travel over the wire.

| Boss | Window | Where | Drops |
|---|---|---|---|
| Bonecrest Tyrant (T-Rex) | early morning, `tod 0.20–0.34` | the radio mast | Ship motor |
| The Salt Maw (Megalodon) | afternoon, `0.48–0.66` | circling the island | Nav radio |
| Cliffshade (Pterodactyl) | evening, `0.70–0.86` | the highest peak | Harpoon |

**Only fire arrows wound them.** Anything else glances off with a message saying so. Each
takes exactly 20. Fire arrows cost 20 scrap + 20 rope, workbench only.

With all three parts, `Use` at the wreck rebuilds the boat and ends the run.

**The island does not stay cleared.** Fifteen minutes after the third boss falls they all
come back with full health, so somebody joining a room later is never locked out of the
endgame. Parts already in a chest or pack are untouched, so a finished run stays finished.

Reset is driven by a cycle counter in the shared boss key rather than a timestamp race:
any client may run the reset, a higher cycle is adopted wholesale by everyone else, and
packets from an older cycle are discarded. Two clients resetting simultaneously converge
on the same state. Tune with `BOSS_RESET_MS`.

Only the player who lands the killing blow picks a part up. Once **all three** are dead
the island is finished for everyone on it, so every character's chest is topped up to a
full set — crewmates who fought but did not loot, and anyone who died holding one, can
still walk to the wreck. It fills only what is missing and never duplicates, and it will
not write into a vault it has not successfully read.

### Tuning the grind

Fire arrows cost 5 scrap + 5 rope. Sixty of them is 300 scrap and 300 rope (900 fibre) —
roughly seven sweeps of the salvage zones, which lands the endgame near 45 minutes.

Resource nodes now regrow after 300s, without which the fibre side was outright
impossible: the island only holds about 930 fibre and nothing used to come back.

If that is heavier than intended, the constants are all in one place:
`RECIPES` (`firearrow` cost), `FIRE_ARROWS_TO_KILL`, `CRATE_REFILL`, `REGROW_SEC`.
Dropping the arrow to 5 scrap + 5 rope makes the whole endgame about 45 minutes.

## First run

New players get a ten-step objective card in the corner: punch a tree, tear bushes, break
rocks for flint, craft a spear, craft an axe, find a coconut, lay a floor, raise walls,
build a firepit, eat something cooked. Each step just watches your inventory — nothing is
gated or blocked, and the card can be skipped. It is remembered per browser, so it never
appears twice.

While the card is up, wildlife will not attack: anything already chasing breaks off and
nothing new aggros. The truce ends the moment the last objective completes, the card is
skipped, or **you land a hit on any beast** — otherwise you could farm animals that
refuse to defend themselves. Anyone who has finished the tutorial once starts hunted.

## Modes

**Marooned — the long game.** Hunger and thirst drain 1.35x. Water runs dry in under seven
minutes, which is less than one in-game day, so the coconut loop is mandatory before dark.

**Castaway — Arcade x2.** Gentler survival drain, and:

- every strike yields double resources (gathering, animal drops, crates)
- you deal double damage to wildlife
- bosses fall to ten fire arrows instead of twenty

Damage to other players is **not** scaled. Arcade is meant to shorten the grind, not turn
a mode selection into a PvP advantage on a shared island.

The choice persists per browser and shows in the HUD next to the island code.

## Clearing an island

Type the island code on the menu and press **Wipe this island** twice. It deletes every
key under `sb:{ROOM}:` — forts, chests, death caches, presence, boss state and the seed.
There is no auth on it: anyone who knows a room code can wipe that room. That is fine for
a room code shared with friends, and wrong for anything public. If this ever ships wider,
move the sweep behind an `op` in `api/kv.js` gated on an `ADMIN_KEY` env var.

Anyone still standing in the room when it is wiped is holding the old world in memory and
should return to the menu and rejoin.

### Why forts used to stand forever

A fort could only be demolished by its owner, or raided while flagged derelict — and a
fort only goes derelict when its owner **dies**. Log out instead of dying and it stood
indefinitely. Worse, anything built before ownership moved to island+name (build 8) has a
random owner key nobody can ever hold again: unsalvageable by anyone, and never derelict,
so not even a raider could break more than its door.

Forts now rot on their own: no `char` field at all (a pre-build-8 orphan) rots
immediately, and any fort untouched for `ABANDON_MS` (48h) goes derelict and then clears
through the normal five-minute window.
