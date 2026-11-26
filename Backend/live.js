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
        visibility VARCHAR(8) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
        status VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )`);
    await pool.query(`ALTER TABLE live_rooms ADD COLUMN IF NOT EXISTS visibility VARCHAR(8) NOT NULL DEFAULT 'public'`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_join_requests (
        id BIGSERIAL PRIMARY KEY,
        room_id BIGINT NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        responded_at TIMESTAMPTZ,
        UNIQUE (room_id, user_id)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS live_join_requests_pending_idx ON live_join_requests(room_id, status)`);
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
      `SELECT l.id, l.host_id, l.dare_id, l.title, l.visibility, l.status, l.started_at,
              u.username AS host_username, u.avatar AS host_avatar
       FROM live_rooms l JOIN users u ON u.id = l.host_id WHERE l.id = $1::bigint`, [id]);
    return r.rows[0] || null;
  }

  async function canWatch(room, userId) {
    if (String(room.host_id) === String(userId) || room.visibility !== 'private') return true;
    const approval = await pool.query(
      `SELECT 1 FROM live_join_requests WHERE room_id=$1::bigint AND user_id=$2::bigint AND status='accepted'`,
      [room.id, userId]
    );
    return approval.rows.length > 0;
  }

  async function canSeeRoom(room, userId) {
    return room.visibility !== 'private'
      || String(room.host_id) === String(userId)
      || (await areFriends(room.host_id, userId));
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
        `SELECT l.id, l.host_id, l.dare_id, l.title, l.visibility, l.started_at,
                u.username AS host_username, u.avatar AS host_avatar,
                CASE WHEN l.host_id=$1::bigint THEN (
                  SELECT COUNT(*)::int FROM live_join_requests r
                  WHERE r.room_id=l.id AND r.status='pending'
                ) ELSE 0 END AS pending_requests
         FROM live_rooms l JOIN users u ON u.id = l.host_id
         WHERE l.status = 'live' AND (
           l.visibility = 'public' OR l.host_id = $1::bigint OR EXISTS (
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
    const visibility = req.body?.visibility ?? 'public';
    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ message: 'Choose public or private for your live.' });
    }
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
        `INSERT INTO live_rooms (host_id, dare_id, title, visibility) VALUES ($1::bigint, $2, $3, $4) RETURNING id`,
        [req.userId, dareId, title, visibility]);
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
      if (!room || !(await canSeeRoom(room, req.userId))) return res.status(404).json({ message: 'Live not found.' });
      const request = room.visibility === 'private'
        ? await pool.query(
          `SELECT status FROM live_join_requests WHERE room_id=$1::bigint AND user_id=$2::bigint`,
          [room.id, req.userId]
        )
        : { rows: [] };
      res.json({
        ...room,
        is_host: String(room.host_id) === String(req.userId),
        can_watch: await canWatch(room, req.userId),
        request_status: request.rows[0]?.status || null,
      });
    } catch (err) {
      console.error('Live get error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/live/:id/requests', authMiddleware, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid live.' });
    try {
      const room = await getRoom(req.params.id);
      if (!room || room.status !== 'live' || room.visibility !== 'private') {
        return res.status(404).json({ message: 'Private live not found.' });
      }
      if (String(room.host_id) === String(req.userId)) {
        return res.status(400).json({ message: 'You are hosting this live.' });
      }
      if (!(await areFriends(room.host_id, req.userId))) {
        return res.status(403).json({ message: 'Only the host’s friends can request to join this private live.' });
      }
      if (await canWatch(room, req.userId)) {
        return res.json({ status: 'accepted' });
      }

      const inserted = await pool.query(
        `INSERT INTO live_join_requests (room_id, user_id)
         VALUES ($1::bigint, $2::bigint)
         ON CONFLICT (room_id, user_id) DO UPDATE
           SET status='pending', created_at=NOW(), responded_at=NULL
           WHERE live_join_requests.status <> 'accepted'
         RETURNING id, status`,
        [room.id, req.userId]
      );
      const request = inserted.rows[0] || (await pool.query(
        `SELECT id, status FROM live_join_requests WHERE room_id=$1::bigint AND user_id=$2::bigint`,
        [room.id, req.userId]
      )).rows[0];
      if (request.status === 'pending') {
        const requester = await pool.query('SELECT username, avatar FROM users WHERE id=$1::bigint', [req.userId]);
        io?.to(`user:${room.host_id}`).emit('live:join-request', {
          roomId: String(room.id),
          requestId: String(request.id),
          userId: String(req.userId),
          username: requester.rows[0]?.username || 'Friend',
          avatar: requester.rows[0]?.avatar || null,
        });
      }
      return res.status(200).json({ status: request.status });
    } catch (err) {
      console.error('Live join request error:', err);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.get('/api/live/:id/requests', authMiddleware, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid live.' });
    try {
      const room = await getRoom(req.params.id);
      if (!room || String(room.host_id) !== String(req.userId)) {
        return res.status(403).json({ message: 'Only the host can view join requests.' });
      }
      const requests = await pool.query(
        `SELECT r.id AS request_id, r.user_id, r.created_at, u.username, u.avatar
         FROM live_join_requests r
         JOIN users u ON u.id = r.user_id
         WHERE r.room_id=$1::bigint AND r.status='pending'
         ORDER BY r.created_at`,
        [room.id]
      );
      return res.json(requests.rows);
    } catch (err) {
      console.error('Live join requests list error:', err);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.patch('/api/live/:id/requests/:userId', authMiddleware, async (req, res) => {
    if (!validId(req.params.id) || !validId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid live join request.' });
    }
    const { status } = req.body || {};
    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({ message: 'Choose whether to accept or decline the request.' });
    }
    try {
      const room = await getRoom(req.params.id);
      if (!room || String(room.host_id) !== String(req.userId)) {
        return res.status(403).json({ message: 'Only the host can respond to join requests.' });
      }
      if (room.status !== 'live' || room.visibility !== 'private') {
        return res.status(409).json({ message: 'This live is no longer accepting requests.' });
      }
      const updated = await pool.query(
        `UPDATE live_join_requests SET status=$1, responded_at=NOW()
         WHERE room_id=$2::bigint AND user_id=$3::bigint AND status='pending'
         RETURNING user_id, status`,
        [status, room.id, req.params.userId]
      );
      if (updated.rows.length === 0) {
        return res.status(404).json({ message: 'Pending join request not found.' });
      }
      io?.to(`user:${req.params.userId}`).emit('live:access', {
        roomId: String(room.id),
        status,
      });
      return res.json({ status });
    } catch (err) {
      console.error('Live join request response error:', err);
      return res.status(500).json({ message: 'Internal server error.' });
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
      socket.join(`user:${socket.userId}`);
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

      socket.on('live:reaction', ({ roomId, reaction, emoji } = {}) => {
        if (!socket.rooms.has(`live:${roomId}`)) return;
        const reactions = {
          heart: '❤️',
          clap: '👏',
          fire: '🔥',
          laugh: '😂',
          wow: '😮',
        };
        const legacyNames = Object.fromEntries(Object.entries(reactions).map(([name, value]) => [value, name]));
        const name = reactions[reaction] ? reaction : legacyNames[emoji];
        if (!name) return;
        io.to(`live:${roomId}`).emit('live:reaction', {
          roomId: String(roomId),
          reaction: name,
          emoji: reactions[name],
        });
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