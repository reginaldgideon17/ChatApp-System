// Backend/push.js  -  Web Push (notifications that arrive even when the site is closed)
const webpush = require('web-push');

function setupPush(app, pool, authMiddleware) {
  const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const SUBJECT = process.env.VAPID_SUBJECT || `mailto:${process.env.MAIL_FROM || 'admin@example.com'}`;
  const enabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);

  if (enabled) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    console.log('[push] Web Push is ON');
  } else {
    console.log('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing: Web Push is OFF (in-tab alerts still work)');
  }

  let io = null;

  async function initPushTable() {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
         id BIGSERIAL PRIMARY KEY,
         user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         endpoint TEXT NOT NULL UNIQUE,
         p256dh TEXT NOT NULL,
         auth TEXT NOT NULL,
         user_agent TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await pool.query('CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id)');
  }

  // Short text for a message: its text, or what kind of file it carries
  function preview(msg) {
    const text = String(msg?.content || '').trim();
    const a = msg?.attachment;
    // attachment-only messages are saved with the text "📎 filename", so show the file type instead
    if (text && !(a && text.startsWith('📎'))) return text.slice(0, 120);
    if (a) {
      const mime = String(a.mime_type || '');
      if (mime.startsWith('audio/')) return '🎤 Voice note';
      if (mime.startsWith('image/')) return '📷 Photo';
      if (mime.startsWith('video/')) return '🎥 Video';
      return `📎 ${a.file_name || 'File'}`;
    }
    return 'New message';
  }

  async function nameOf(userId) {
    try {
      const r = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      return r.rows[0]?.username || 'Someone';
    } catch {
      return 'Someone';
    }
  }

  // payload: { title, body, url, tag }
  async function sendToUser(userId, payload) {
    try {
      const data = {
        title: String(payload.title || 'Morphues').slice(0, 80),
        body: String(payload.body || '').slice(0, 140),
        url: payload.url || '/chat',
        tag: payload.tag || undefined,
      };

      // 1) people with the site open get it over the socket (sound, tab title, etc.)
      if (io) io.to(`user:${userId}`).emit('appAlert', data);

      // 2) real Web Push, for every browser/phone this person turned notifications on for
      if (!enabled) return;
      const subs = await pool.query(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
        [userId]
      );
      const body = JSON.stringify(data);
      await Promise.all(
        subs.rows.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              body,
              { TTL: 3600, urgency: 'high' }
            );
          } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]); // expired
            } else {
              console.error('[push] send failed:', err.statusCode || err.message);
            }
          }
        })
      );
    } catch (err) {
      console.error('[push] sendToUser error:', err.message);
    }
  }

  async function sendToUsers(userIds, payload) {
    await Promise.all(userIds.map((id) => sendToUser(id, payload)));
  }

  app.get('/api/push/public-key', (req, res) => {
    res.json({ enabled, key: enabled ? PUBLIC_KEY : null });
  });

  app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
    const sub = req.body?.subscription;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !p256dh || !auth) {
      return res.status(400).json({ message: 'Invalid subscription.' });
    }
    try {
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint)
         DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [req.userId, endpoint, p256dh, auth, String(req.headers['user-agent'] || '').slice(0, 250)]
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[push] subscribe error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/push/unsubscribe', authMiddleware, async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') return res.status(400).json({ message: 'endpoint is required.' });
    try {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.userId]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[push] unsubscribe error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/push/test', authMiddleware, async (req, res) => {
    await sendToUser(req.userId, {
      title: 'Morphues',
      body: 'Notifications are working 🎉',
      url: '/settings',
      tag: 'test',
    });
    res.json({ ok: true, pushEnabled: enabled });
  });

  return {
    initPushTable,
    attachIO(socketIo) { io = socketIo; },
    sendToUser,
    sendToUsers,
    preview,
    nameOf,
  };
}

module.exports = { setupPush };
