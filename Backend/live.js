// Live rooms: a person goes live (optionally for a dare), friends watch, chat and vote.
// Video travels through LiveKit (a media server). This file only hands out
// permission tokens and runs the chat/votes over your existing socket.io server.
// Needs 3 env vars on Render: LIVEKIT_URL (wss://...), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
const jwt = require('jsonwebtoken');

function setupLive(app, pool, authMiddleware, push) {
  let io = null;
  const votes = new Map(); // roomId -> Map(userId -> 'pass' | 'fail')

  async function initLiveTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_rooms (
        id BIGSERIAL PRIMARY KEY,
        host_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dare_id BIGINT,
        title VARCHAR(100) NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS live_rooms_status_idx ON live_rooms(status, started_at DESC)`);
    // rooms left "live" by a server restart are closed
    await pool.query(`UPDATE live_rooms SET status='ended', ended_at=NOW() WHERE status='live'`);
  }

  // pasted values often carry spaces, quotes or line breaks: clean them
  const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  function lkEnv() {
    return {
      LIVEKIT_URL: clean(process.env.LIVEKIT_URL),
      LIVEKIT_API_KEY: clean(process.env.LIVEKIT_API_KEY),
      LIVEKIT_API_SECRET: clean(process.env.LIVEKIT_API_SECRET),
    };
  }

  // Safe check: shows the SHAPE of your LiveKit settings, never the secret.
  app.get('/api/live-check', authMiddleware, (req, res) => {
    const raw = process.env;
    const e = lkEnv();
    res.json({
      urlStartsWithWss: e.LIVEKIT_URL.startsWith('wss://'),
      url: e.LIVEKIT_URL,
      keyFirst4: e.LIVEKIT_API_KEY.slice(0, 4),
      keyLength: e.LIVEKIT_API_KEY.length,
      secretLength: e.LIVEKIT_API_SECRET.length,
      keyHadExtraSpaces: String(raw.LIVEKIT_API_KEY || '') !== e.LIVEKIT_API_KEY,
      secretHadExtraSpaces: String(raw.LIVEKIT_API_SECRET || '') !== e.LIVEKIT_API_SECRET,
      secretLooksLikeKey: e.LIVEKIT_API_SECRET.startsWith('API'),
    });
  });

  const validId = (v) => /^\d+$/.test(String(v)) && String(v).length < 16;

  async function areFriends(a, b) {
    const r = await pool.query(
      `SELECT 1 FROM friendships WHERE status='accepted'
       AND ((requester_id=$1::bigint AND addressee_id=$2::bigint) OR (requester_id=$2::bigint AND addressee_id=$1::bigint)) LIMIT 1`,
      [a, b]);
    return r.rows.length > 0;
  }

  async function getRoom(id) {
    const r = await pool.query(
      `SELECT l.id, l.host_id, l.dare_id, l.title, l.status, l.started_at,
              u.username AS host_username, u.avatar AS host_avatar
       FROM live_rooms l JOIN users u ON u.id = l.host_id WHERE l.id = $1::bigint`, [id]);
    return r.rows[0] || null;
  }

  async function canWatch(room, userId) {
    return String(room.host_id) === String(userId) || (await areFriends(room.host_id, userId));
  }

  function tally(roomId) {
    const m = votes.get(String(roomId)) || new Map();
    let pass = 0, fail = 0;
    m.forEach((v) => (v === 'pass' ? pass++ : fail++));
    return { pass, fail };
  }

  async function viewerCount(roomId) {
    if (!io) return 0;
    const sockets = await io.in(`live:${roomId}`).fetchSockets();
    return new Set(sockets.map((s) => String(s.data?.userId))).size;
  }

  // ---------- routes ----------
  app.get('/api/live', authMiddleware, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT l.id, l.host_id, l.dare_id, l.title, l.started_at,
                u.username AS host_username, u.avatar AS host_avatar
         FROM live_rooms l JOIN users u ON u.id = l.host_id
         WHERE l.status = 'live' AND (
           l.host_id = $1::bigint OR EXISTS (
             SELECT 1 FROM friendships f WHERE f.status='accepted' AND
             ((f.requester_id=$1::bigint AND f.addressee_id=l.host_id) OR (f.addressee_id=$1::bigint AND f.requester_id=l.host_id))))
         ORDER BY l.started_at DESC LIMIT 30`, [req.userId]);
      res.json(r.rows);
    } catch (err) {
      console.error('Live list error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/live', authMiddleware, async (req, res) => {
    const title = String(req.body?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (title.length < 3) return res.status(400).json({ message: 'Give your live a short title.' });
    const dareId = req.body?.dareId ? String(req.body.dareId) : null;
    if (dareId && !validId(dareId)) return res.status(400).json({ message: 'Invalid dare.' });
    try {
      if (dareId) {
        const d = await pool.query(
          `SELECT 1 FROM dares WHERE id=$1::bigint AND recipient_id=$2::bigint AND status='accepted'`, [dareId, req.userId]);
        if (d.rows.length === 0) return res.status(403).json({ message: 'You can only go live for a dare you accepted.' });
      }
      await pool.query(`UPDATE live_rooms SET status='ended', ended_at=NOW() WHERE host_id=$1::bigint AND status='live'`, [req.userId]);
      const ins = await pool.query(
        `INSERT INTO live_rooms (host_id, dare_id, title) VALUES ($1::bigint, $2, $3) RETURNING id`,
        [req.userId, dareId, title]);
      const room = await getRoom(ins.rows[0].id);

      const friends = await pool.query(
        `SELECT CASE WHEN requester_id=$1::bigint THEN addressee_id ELSE requester_id END AS id
         FROM friendships WHERE status='accepted' AND (requester_id=$1::bigint OR addressee_id=$1::bigint)`, [req.userId]);
      friends.rows.forEach((f) => {
        if (io) io.to(`user:${f.id}`).emit('liveChanged');
        push.sendToUser(f.id, {
          title: room.host_username, body: `is live: ${title}`.slice(0, 120), url: `/live/${room.id}`, tag: `live-${room.id}`,
        });
      });
      res.status(201).json(room);
    } catch (err) {
      console.error('Live start error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.get('/api/live/:id', authMiddleware, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid live.' });
    try {
      const room = await getRoom(req.params.id);
      if (!room || !(await canWatch(room, req.userId))) return res.status(404).json({ message: 'Live not found.' });
      res.json(room);
    } catch (err) {
      console.error('Live get error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/live/:id/token', authMiddleware, async (req, res) => {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = lkEnv();
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ message: 'Live video is not set up on the server yet.' });
    }
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid live.' });
    try {
      const room = await getRoom(req.params.id);
      if (!room || room.status !== 'live' || !(await canWatch(room, req.userId))) {
        return res.status(404).json({ message: 'This live has ended or does not exist.' });
      }
      const isHost = String(room.host_id) === String(req.userId);
      const me = await pool.query('SELECT username FROM users WHERE id=$1::bigint', [req.userId]);
      const token = jwt.sign(
        {
          name: me.rows[0]?.username || 'viewer',
          video: {
            room: `live-${room.id}`, roomJoin: true,
            canPublish: isHost, canPublishData: false, canSubscribe: true,
          },
        },
        LIVEKIT_API_SECRET,
        { algorithm: 'HS256', issuer: LIVEKIT_API_KEY, subject: `user-${req.userId}`, expiresIn: '2h' });
      res.json({ token, url: LIVEKIT_URL, role: isHost ? 'host' : 'viewer' });
    } catch (err) {
      console.error('Live token error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  async function endRoom(roomId) {
    await pool.query(`UPDATE live_rooms SET status='ended', ended_at=NOW() WHERE id=$1::bigint`, [roomId]);
    votes.delete(String(roomId));
    if (io) io.to(`live:${roomId}`).emit('live:ended', { roomId: String(roomId) });
  }

  app.post('/api/live/:id/end', authMiddleware, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid live.' });
    try {
      const room = await getRoom(req.params.id);
      if (!room || String(room.host_id) !== String(req.userId)) return res.status(403).json({ message: 'Only the host can end the live.' });
      await endRoom(room.id);
      res.json({ ok: true });
    } catch (err) {
      console.error('Live end error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ---------- realtime: chat, votes, viewer count ----------
  function attachIO(socketIo) {
    io = socketIo;
    io.on('connection', (socket) => {
      socket.data.userId = socket.userId; // fetchSockets() only exposes socket.data
      const lastChat = { t: 0 };

      socket.on('live:join', async ({ roomId } = {}, ack) => {
        try {
          if (!validId(roomId)) return ack?.({ ok: false });
          const room = await getRoom(roomId);
          if (!room || room.status !== 'live' || !(await canWatch(room, socket.userId))) return ack?.({ ok: false });
          socket.join(`live:${roomId}`);
          socket.liveRooms = (socket.liveRooms || new Set()).add(String(roomId));
          const count = await viewerCount(roomId);
          io.to(`live:${roomId}`).emit('live:viewers', { roomId: String(roomId), count });
          ack?.({ ok: true, ...tally(roomId), count });
        } catch { ack?.({ ok: false }); }
      });

      socket.on('live:leave', async ({ roomId } = {}) => {
        socket.leave(`live:${roomId}`);
        const count = await viewerCount(roomId);
        io.to(`live:${roomId}`).emit('live:viewers', { roomId: String(roomId), count });
      });

      socket.on('live:chat', async ({ roomId, text } = {}) => {
        if (!socket.rooms.has(`live:${roomId}`)) return;
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!clean || Date.now() - lastChat.t < 700) return; // simple flood guard
        lastChat.t = Date.now();
        const u = await pool.query('SELECT username, avatar FROM users WHERE id=$1::bigint', [socket.userId]);
        io.to(`live:${roomId}`).emit('live:chat', {
          roomId: String(roomId), userId: String(socket.userId),
          username: u.rows[0]?.username || 'user', text: clean, at: Date.now(),
        });
      });

      socket.on('live:vote', async ({ roomId, vote } = {}) => {
        if (!socket.rooms.has(`live:${roomId}`) || !['pass', 'fail'].includes(vote)) return;
        const room = await getRoom(roomId);
        if (!room || String(room.host_id) === String(socket.userId)) return; // host cannot vote
        const key = String(roomId);
        if (!votes.has(key)) votes.set(key, new Map());
        votes.get(key).set(String(socket.userId), vote);
        io.to(`live:${roomId}`).emit('live:votes', { roomId: key, ...tally(key) });
      });

      socket.on('live:reaction', ({ roomId, emoji } = {}) => {
        if (!socket.rooms.has(`live:${roomId}`) || !['🔥', '👏', '😂', '😮', '❤️'].includes(emoji)) return;
        io.to(`live:${roomId}`).emit('live:reaction', { roomId: String(roomId), emoji });
      });

      socket.on('disconnect', async () => {
        for (const roomId of socket.liveRooms || []) {
          const count = await viewerCount(roomId);
          io.to(`live:${roomId}`).emit('live:viewers', { roomId, count });
        }
      });
    });
  }

  return { initLiveTables, attachIO };
}

module.exports = { setupLive };