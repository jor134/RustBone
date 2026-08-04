// api/kv.js — Upstash Redis proxy for SALTBONE.
// The Upstash token stays server-side. The browser only ever sees this endpoint.
//
// Required Vercel environment variables:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// Every key must look like  sb:{ROOM}:{rest}  — anything else is rejected, so a
// client can't read or trample keys outside the game namespace.

const KEY_RE = /^sb:[A-Z0-9]{1,6}:[A-Za-z0-9:_-]{1,90}$/;
const PREFIX_RE = /^sb:[A-Z0-9]{1,6}:[A-Za-z0-9:_-]{0,90}$/;
const MAX_VALUE = 220 * 1024;
const MAX_TTL = 60 * 60 * 24 * 7;

// Vercel injects different names depending on how the store was created:
// the Upstash integration uses UPSTASH_REDIS_REST_*, the Marketplace/KV path
// uses KV_REST_API_*. Accept every spelling rather than making you rename them.
function creds() {
  const e = process.env;
  const url = e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL || e.REDIS_REST_URL || '';
  const token = e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN || e.REDIS_REST_TOKEN || '';
  return { url, token };
}

async function redis(cmd) {
  const { url, token } = creds();
  if (!url || !token) throw new Error('no Upstash URL/token in the environment');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('Upstash ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const { op, key, prefix } = req.query;

      if (op === 'ping') {
        const { url, token } = creds();
        // which relevant names actually exist, so you can see the mismatch
        const found = Object.keys(process.env)
          .filter(k => /UPSTASH|KV_REST|REDIS/i.test(k)).sort();
        if (!url || !token) {
          return res.status(200).json({
            ok: false, live: false, found,
            error: 'Function is deployed but no Upstash URL/token is set. ' +
                   'Env vars visible to it: ' + (found.join(', ') || 'none') +
                   '. Note env vars only apply to deployments made AFTER you add them — redeploy.'
          });
        }
        try {
          // real round trip: catches a wrong or expired token, which a
          // presence check alone would miss
          await redis(['SET', 'sb:DIAG:ping', String(Date.now()), 'EX', '60']);
          const v = await redis(['GET', 'sb:DIAG:ping']);
          return res.status(200).json({ ok: true, live: !!v, found });
        } catch (e) {
          return res.status(200).json({ ok: true, live: false, found, error: String(e.message || e) });
        }
      }

      if (op === 'get') {
        if (!KEY_RE.test(key || '')) return res.status(400).json({ error: 'bad key' });
        const value = await redis(['GET', key]);
        return res.status(200).json({ key, value: value === null ? null : String(value) });
      }

      if (op === 'scan') {
        if (!PREFIX_RE.test(prefix || '')) return res.status(400).json({ error: 'bad prefix' });
        let cursor = '0';
        const keys = [];
        // bounded: a room never holds more than a few hundred keys
        for (let i = 0; i < 8; i++) {
          const out = await redis(['SCAN', cursor, 'MATCH', prefix + '*', 'COUNT', 250]);
          cursor = out[0];
          for (const k of out[1]) if (keys.indexOf(k) === -1) keys.push(k);
          if (cursor === '0' || keys.length > 400) break;
        }
        if (!keys.length) return res.status(200).json({ items: [] });
        const vals = await redis(['MGET'].concat(keys));
        const items = keys.map((k, i) => ({ key: k, value: vals[i] === null ? null : String(vals[i]) }))
                          .filter(it => it.value !== null);
        return res.status(200).json({ items });
      }

      return res.status(400).json({ error: 'unknown op' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { op, key, value, ttl } = body;

      if (!KEY_RE.test(key || '')) return res.status(400).json({ error: 'bad key' });

      if (op === 'set') {
        const v = String(value == null ? '' : value);
        if (v.length > MAX_VALUE) return res.status(413).json({ error: 'value too large' });
        const ex = Math.min(parseInt(ttl, 10) || 259200, MAX_TTL);
        await redis(['SET', key, v, 'EX', String(ex)]);
        return res.status(200).json({ ok: true });
      }

      if (op === 'del') {
        await redis(['DEL', key]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'unknown op' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
