// Backend/dares.js  -  Dares game (friends-only, points only)
// Flow: pending -> accepted -> submitted -> approved (points) | redo (back to accepted) | declined | expired

const CATEGORIES = {
  creative: { label: 'Creative', points: 50 },
  art: { label: 'Art', points: 30 },
  photo: { label: 'Photo', points: 20 },
  trivia: { label: 'Trivia', points: 30 },
  dance: { label: 'Dance', points: 40 },
  funny: { label: 'Funny', points: 40 },
};
const TIME_LIMITS = [10, 60, 1440]; // minutes
const MAX_PROOF_SIZE = 10 * 1024 * 1024;
const MAX_DARES_PER_DAY = 20;
const MAX_ACTIVE_PER_PAIR = 5;

const LIBRARY = {
  creative: ['Sing the chorus of your favourite song in a voice note', 'Tell a joke in your best accent', 'Hum a song and let me guess it', 'Make up a 4-line rap about your day'],
  art: ['Draw your best friend in 60 seconds', 'Draw your hometown using only 3 colours', 'Draw a cat using only 3 shapes', 'Doodle your day as a comic strip'],
  photo: ['Share a photo of what is on your desk right now', 'Take a photo of the best thing you can see from your window', 'Photo of something blue in under 30 seconds', 'Photo of your favourite snack'],
  trivia: ['Name 10 capital cities in 30 seconds', 'Name 5 movies from the 2000s in a voice note', 'List 8 animals that start with the letter B', 'Say the alphabet backwards'],
  dance: ['Do a 10-second dance in your room', 'Teach us one easy dance move', 'Dance to the first song that plays', 'Show your best victory dance'],
  funny: ['Do your best impression of a friend', 'Make the funniest face you can', 'Tell a funny story in 30 seconds', 'Describe your day like a sports commentator'],
};

// Simple safety net for dare text. It blocks obviously unsafe or inappropriate dares.
// It is a first filter only: reports and blocks are the second line of defence.
const UNSAFE_PATTERNS = [
  /\b(kill|suicid\w*|self[- ]?harm|hurt (your|my)self|cut (your|my)self|overdose)\b/,
  /\b(nude|naked|sex\w*|stripper\w*|striptease|stripping|strip (down|off)|porn\w*|underwear|lingerie|boob\w*)\b/,
  /\b(drug\w*|weed|cocaine|alcohol\w*|drunk|vodka|beer|smok(e|ing)|vape|cigarette\w*)\b/,
  /\b(fight\w*|punch\w*|slap\w*|beat up|bully\w*|harass\w*|stalk\w*|humiliat\w*)\b/,
  /\b(steal|rob|shoplift\w*|trespass\w*|break into|vandal\w*|graffiti)\b/,
  /\b(stranger|strangers)\b/,
  /\b(jump(s|ed|ing)? (off|from|out)|cliff|roof|rooftop|balcony|ledge|traffic|highway|railway|train tracks|speeding|drive fast)\b/,
  /\b(fire|flame|burn\w*|knife|gun|weapon\w*|blade|poison\w*)\b/,
  /\b(hold your breath|choke|faint|pass out|blindfold\w*)\b/,
  /\b(home address|phone number|password|bank|pin code|your location)\b/,
];

function isUnsafe(text) {
  const t = String(text).toLowerCase().replace(/[​-‍﻿]/g, '');
  return UNSAFE_PATTERNS.some((re) => re.test(t));
}

function parseProof(value) {
  if (!value || typeof value !== 'object' || typeof value.data !== 'string') throw new Error('Invalid proof.');
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.data);
  if (!m) throw new Error('Invalid proof data.');
  const mime = m[1].toLowerCase();
  if (!/^(image|video|audio)\/[\w.+-]+$/.test(mime)) throw new Error('Proof must be a photo, video or voice note.');
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.toString('base64') !== m[2]) throw new Error('Invalid proof data.');
  if (buffer.length === 0) throw new Error('Proof is empty.');
  if (buffer.length > MAX_PROOF_SIZE) throw new Error('Proof must be 10 MB or smaller.');
  const name = String(value.file_name || 'proof').replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180) || 'proof';
  return { name, mime, buffer };
}

function setupDares(app, pool, authMiddleware, push) {
  let io = null;

  async function initDaresTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dares (
        id BIGSERIAL PRIMARY KEY,
        sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text VARCHAR(200) NOT NULL,
        category VARCHAR(20) NOT NULL,
        points INT NOT NULL,
        time_limit_minutes INT NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','accepted','submitted','approved','declined')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        submitted_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        proof_name TEXT,
        proof_mime TEXT,
        proof_size INT,
        proof_data BYTEA,
        proof_note VARCHAR(200),
        CHECK (sender_id <> recipient_id)
      )`);
    await pool.query('CREATE INDEX IF NOT EXISTS dares_recipient_idx ON dares (recipient_id, status)');
    await pool.query('CREATE INDEX IF NOT EXISTS dares_sender_idx ON dares (sender_id, status)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dare_points_log (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dare_id BIGINT NOT NULL UNIQUE REFERENCES dares(id) ON DELETE CASCADE,
        points INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query('CREATE INDEX IF NOT EXISTS dare_points_user_idx ON dare_points_log (user_id, created_at)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dare_settings (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        allow_dares BOOLEAN NOT NULL DEFAULT TRUE
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dare_blocks (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, blocked_id)
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dare_reports (
        id BIGSERIAL PRIMARY KEY,
        dare_id BIGINT NOT NULL REFERENCES dares(id) ON DELETE CASCADE,
        reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(200) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  }

  // Every dare as the API shows it. "expired" is worked out here, so no timer job is needed.
  const BASE = `
    SELECT d.id, d.sender_id, d.recipient_id, d.text, d.category, d.points, d.time_limit_minutes,
           d.created_at, d.expires_at, d.accepted_at, d.submitted_at, d.completed_at,
           d.proof_name, d.proof_mime, d.proof_size, d.proof_note,
           (d.proof_name IS NOT NULL) AS has_proof,
           CASE WHEN d.status IN ('pending','accepted') AND d.expires_at < NOW() THEN 'expired' ELSE d.status END AS status,
           su.username AS sender_username, su.avatar AS sender_avatar,
           ru.username AS recipient_username, ru.avatar AS recipient_avatar
    FROM dares d
    JOIN users su ON su.id = d.sender_id
    JOIN users ru ON ru.id = d.recipient_id`;

  function ping(...userIds) {
    if (!io) return;
    userIds.forEach((id) => io.to(`user:${id}`).emit('daresChanged'));
  }

  async function areFriends(a, b) {
    const r = await pool.query(
      `SELECT 1 FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
      [a, b]
    );
    return r.rows.length > 0;
  }

  async function getDare(id) {
    const r = await pool.query(`SELECT * FROM (${BASE}) q WHERE q.id = $1`, [id]);
    return r.rows[0] || null;
  }

  function validId(value) {
    return /^\d+$/.test(String(value)) && String(value).length < 16;
  }

  // ---------- reference data ----------
  app.get('/api/dares/library', authMiddleware, (req, res) => {
    res.json({
      categories: Object.entries(CATEGORIES).map(([id, c]) => ({
        id, label: c.label, points: c.points, ideas: LIBRARY[id],
      })),
      timeLimits: TIME_LIMITS,
    });
  });

  // ---------- leaderboard / stats / settings (before /:id routes) ----------
  app.get('/api/dares/leaderboard', authMiddleware, async (req, res) => {
    const allTime = req.query.range === 'all';
    try {
      const r = await pool.query(
        `WITH circle AS (
           SELECT CASE WHEN f.requester_id = $1::bigint THEN f.addressee_id ELSE f.requester_id END AS id
           FROM friendships f
           WHERE (f.requester_id = $1::bigint OR f.addressee_id = $1::bigint) AND f.status = 'accepted'
           UNION SELECT $1::bigint
         )
         SELECT u.id, u.username, u.avatar,
                COALESCE(SUM(p.points) FILTER (WHERE $2::boolean OR p.created_at > NOW() - INTERVAL '7 days'), 0)::int AS points,
                (COUNT(p.id) FILTER (WHERE $2::boolean OR p.created_at > NOW() - INTERVAL '7 days'))::int AS completed
         FROM circle c
         JOIN users u ON u.id = c.id
         LEFT JOIN dare_points_log p ON p.user_id = u.id
         GROUP BY u.id, u.username, u.avatar
         ORDER BY points DESC, u.username ASC
         LIMIT 50`,
        [req.userId, allTime]
      );
      res.json(r.rows.map((row, i) => ({ ...row, rank: i + 1, isMe: String(row.id) === String(req.userId) })));
    } catch (err) {
      console.error('Dares leaderboard error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.get('/api/dares/stats', authMiddleware, async (req, res) => {
    try {
      const [totals, counts, days, awaiting] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(points),0)::int AS total,
                  COALESCE(SUM(points) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'),0)::int AS week
           FROM dare_points_log WHERE user_id = $1`, [req.userId]),
        pool.query(
          `SELECT category, status FROM (${BASE}) q WHERE q.recipient_id = $1`, [req.userId]),
        pool.query(
          `SELECT DISTINCT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d
           FROM dare_points_log WHERE user_id = $1 ORDER BY d DESC LIMIT 60`, [req.userId]),
        pool.query(`SELECT COUNT(*)::int AS n FROM dares WHERE sender_id = $1 AND status = 'submitted'`, [req.userId]),
      ]);

      let approved = 0, ended = 0, active = 0;
      const byCategory = {};
      counts.rows.forEach((row) => {
        if (row.status === 'approved') { approved += 1; byCategory[row.category] = (byCategory[row.category] || 0) + 1; }
        if (['approved', 'declined', 'expired'].includes(row.status)) ended += 1;
        if (['pending', 'accepted'].includes(row.status)) active += 1;
      });

      // streak = consecutive UTC days (ending today or yesterday) with at least one approved dare
      const dayKey = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
      const set = new Set(days.rows.map((r) => r.d));
      let streak = 0;
      let start = set.has(dayKey(0)) ? 0 : (set.has(dayKey(1)) ? 1 : -1);
      while (start >= 0 && set.has(dayKey(start + streak))) streak += 1;

      const badges = [
        { id: 'first', label: 'First dare', icon: '🎯', earned: approved >= 1 },
        { id: 'creative', label: 'Singer', icon: '🎤', earned: (byCategory.creative || 0) >= 5 },
        { id: 'art', label: 'Artist', icon: '✏️', earned: (byCategory.art || 0) >= 5 },
        { id: 'photo', label: 'Photographer', icon: '📸', earned: (byCategory.photo || 0) >= 5 },
        { id: 'trivia', label: 'Brainiac', icon: '🧠', earned: (byCategory.trivia || 0) >= 5 },
        { id: 'streak', label: '3-day streak', icon: '🔥', earned: streak >= 3 },
        { id: 'ten', label: 'Dare devil', icon: '🏅', earned: approved >= 10 },
      ];

      res.json({
        points: totals.rows[0].total,
        weekPoints: totals.rows[0].week,
        completed: approved,
        successRate: ended > 0 ? Math.round((approved / ended) * 100) : null,
        streak,
        activeForYou: active,
        awaitingReview: awaiting.rows[0].n,
        badges,
      });
    } catch (err) {
      console.error('Dares stats error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.get('/api/dares/settings', authMiddleware, async (req, res) => {
    try {
      const s = await pool.query('SELECT allow_dares FROM dare_settings WHERE user_id = $1', [req.userId]);
      const b = await pool.query(
        `SELECT u.id, u.username, u.avatar FROM dare_blocks b JOIN users u ON u.id = b.blocked_id
         WHERE b.user_id = $1 ORDER BY u.username`, [req.userId]);
      res.json({ allowDares: s.rows[0] ? s.rows[0].allow_dares : true, blocked: b.rows });
    } catch (err) {
      console.error('Dares settings error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.patch('/api/dares/settings', authMiddleware, async (req, res) => {
    if (typeof req.body?.allowDares !== 'boolean') return res.status(400).json({ message: 'allowDares must be true or false.' });
    try {
      await pool.query(
        `INSERT INTO dare_settings (user_id, allow_dares) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET allow_dares = EXCLUDED.allow_dares`,
        [req.userId, req.body.allowDares]);
      res.json({ allowDares: req.body.allowDares });
    } catch (err) {
      console.error('Dares settings update error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/dares/blocks/:userId', authMiddleware, async (req, res) => {
    if (!validId(req.params.userId) || String(req.params.userId) === String(req.userId)) {
      return res.status(400).json({ message: 'Invalid user.' });
    }
    try {
      await pool.query(
        'INSERT INTO dare_blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.userId, req.params.userId]);
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err.code === '23503') return res.status(404).json({ message: 'User not found.' });
      console.error('Dare block error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.delete('/api/dares/blocks/:userId', authMiddleware, async (req, res) => {
    if (!validId(req.params.userId)) return res.status(400).json({ message: 'Invalid user.' });
    try {
      await pool.query('DELETE FROM dare_blocks WHERE user_id = $1 AND blocked_id = $2', [req.userId, req.params.userId]);
      res.json({ ok: true });
    } catch (err) {
      console.error('Dare unblock error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ---------- list / create ----------
  app.get('/api/dares', authMiddleware, async (req, res) => {
    const box = req.query.box;
    let where;
    let order;
    if (box === 'received') {
      where = `q.recipient_id = $1 AND q.status IN ('pending','accepted')`;
      order = 'q.expires_at ASC';
    } else if (box === 'sent') {
      where = `q.sender_id = $1 AND q.status IN ('pending','accepted','submitted')`;
      order = `(q.status = 'submitted') DESC, q.created_at DESC`;
    } else if (box === 'done') {
      where = `(q.recipient_id = $1 OR q.sender_id = $1) AND q.status IN ('approved','declined','expired')`;
      order = 'COALESCE(q.completed_at, q.expires_at) DESC';
    } else {
      return res.status(400).json({ message: 'box must be received, sent or done.' });
    }
    try {
      const r = await pool.query(`SELECT * FROM (${BASE}) q WHERE ${where} ORDER BY ${order} LIMIT 60`, [req.userId]);
      res.json(r.rows);
    } catch (err) {
      console.error('List dares error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/dares', authMiddleware, async (req, res) => {
    const recipientId = String(req.body?.recipientId ?? '');
    const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim();
    const category = String(req.body?.category ?? '');
    const minutes = Number(req.body?.timeLimitMinutes);

    if (!validId(recipientId)) return res.status(400).json({ message: 'Pick a friend to dare.' });
    if (recipientId === String(req.userId)) return res.status(400).json({ message: 'You cannot dare yourself.' });
    if (!CATEGORIES[category]) return res.status(400).json({ message: 'Pick a category.' });
    if (!TIME_LIMITS.includes(minutes)) return res.status(400).json({ message: 'Pick a time limit.' });
    if (text.length < 5 || text.length > 200) return res.status(400).json({ message: 'A dare must be 5 to 200 characters.' });
    if (isUnsafe(text)) {
      return res.status(400).json({
        message: 'That dare cannot be sent because it may be unsafe or inappropriate. Try something creative, like singing, drawing or a photo.',
      });
    }

    try {
      if (!(await areFriends(req.userId, recipientId))) {
        return res.status(403).json({ message: 'You can only dare your friends.' });
      }
      const blocked = await pool.query(
        `SELECT 1 FROM dare_blocks
         WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)`,
        [req.userId, recipientId]);
      if (blocked.rows.length > 0) return res.status(403).json({ message: 'You cannot send a dare to this person.' });

      const allow = await pool.query('SELECT allow_dares FROM dare_settings WHERE user_id = $1', [recipientId]);
      if (allow.rows[0] && allow.rows[0].allow_dares === false) {
        return res.status(403).json({ message: 'This friend is not taking dares right now.' });
      }

      const recent = await pool.query(
        `SELECT COUNT(*)::int AS n FROM dares WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [req.userId]);
      if (recent.rows[0].n >= MAX_DARES_PER_DAY) {
        return res.status(429).json({ message: 'You have sent a lot of dares today. Try again tomorrow.' });
      }
      const active = await pool.query(
        `SELECT COUNT(*)::int AS n FROM dares
         WHERE sender_id = $1 AND recipient_id = $2 AND status IN ('pending','accepted') AND expires_at > NOW()`,
        [req.userId, recipientId]);
      if (active.rows[0].n >= MAX_ACTIVE_PER_PAIR) {
        return res.status(429).json({ message: 'This friend already has several dares from you. Let them finish some first.' });
      }

      const inserted = await pool.query(
        `INSERT INTO dares (sender_id, recipient_id, text, category, points, time_limit_minutes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(mins => $6::int))
         RETURNING id`,
        [req.userId, recipientId, text, category, CATEGORIES[category].points, minutes]);
      const dare = await getDare(inserted.rows[0].id);

      ping(req.userId, recipientId);
      push.sendToUser(recipientId, {
        title: dare.sender_username,
        body: `dared you: ${text}`.slice(0, 120),
        url: '/dares',
        tag: `dare-${dare.id}`,
      });
      res.status(201).json(dare);
    } catch (err) {
      console.error('Create dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ---------- one dare ----------
  async function loadForParticipant(req, res) {
    if (!validId(req.params.id)) { res.status(400).json({ message: 'Invalid dare.' }); return null; }
    const dare = await getDare(req.params.id);
    if (!dare || (String(dare.sender_id) !== String(req.userId) && String(dare.recipient_id) !== String(req.userId))) {
      res.status(404).json({ message: 'Dare not found.' });
      return null;
    }
    return dare;
  }

  app.get('/api/dares/:id', authMiddleware, async (req, res) => {
    try {
      const dare = await loadForParticipant(req, res);
      if (dare) res.json(dare);
    } catch (err) {
      console.error('Get dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/dares/:id/accept', authMiddleware, async (req, res) => {
    try {
      const dare = await loadForParticipant(req, res);
      if (!dare) return;
      if (String(dare.recipient_id) !== String(req.userId)) return res.status(403).json({ message: 'Only the person dared can accept.' });
      if (dare.status === 'expired') return res.status(409).json({ message: 'This dare has run out of time.' });
      if (dare.status !== 'pending') return res.status(409).json({ message: 'This dare cannot be accepted now.' });

      await pool.query(
        `UPDATE dares SET status = 'accepted', accepted_at = NOW() WHERE id = $1 AND status = 'pending'`, [dare.id]);
      ping(dare.sender_id, dare.recipient_id);
      push.sendToUser(dare.sender_id, {
        title: dare.recipient_username, body: 'accepted your dare 🎯', url: '/dares', tag: `dare-${dare.id}`,
      });
      res.json(await getDare(dare.id));
    } catch (err) {
      console.error('Accept dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // Skipping or quitting never costs anything
  app.post('/api/dares/:id/decline', authMiddleware, async (req, res) => {
    try {
      const dare = await loadForParticipant(req, res);
      if (!dare) return;
      if (String(dare.recipient_id) !== String(req.userId)) return res.status(403).json({ message: 'Only the person dared can skip.' });
      if (!['pending', 'accepted'].includes(dare.status)) return res.status(409).json({ message: 'This dare cannot be skipped now.' });

      await pool.query(
        `UPDATE dares SET status = 'declined', completed_at = NOW() WHERE id = $1 AND status IN ('pending','accepted')`, [dare.id]);
      ping(dare.sender_id, dare.recipient_id);
      res.json(await getDare(dare.id));
    } catch (err) {
      console.error('Decline dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/dares/:id/proof', authMiddleware, async (req, res) => {
    let proof;
    try {
      proof = parseProof(req.body?.attachment);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    const note = String(req.body?.note ?? '').trim().slice(0, 200) || null;
    try {
      const dare = await loadForParticipant(req, res);
      if (!dare) return;
      if (String(dare.recipient_id) !== String(req.userId)) return res.status(403).json({ message: 'Only the person dared can submit proof.' });
      if (dare.status === 'expired') return res.status(409).json({ message: 'Time ran out for this dare.' });
      if (dare.status !== 'accepted') return res.status(409).json({ message: 'Accept the dare before sending proof.' });

      await pool.query(
        `UPDATE dares
         SET status = 'submitted', submitted_at = NOW(),
             proof_name = $2, proof_mime = $3, proof_size = $4, proof_data = $5, proof_note = $6
         WHERE id = $1 AND status = 'accepted' AND expires_at > NOW()`,
        [dare.id, proof.name, proof.mime, proof.buffer.length, proof.buffer, note]);
      const updated = await getDare(dare.id);
      if (updated.status !== 'submitted') return res.status(409).json({ message: 'Time ran out for this dare.' });

      ping(dare.sender_id, dare.recipient_id);
      push.sendToUser(dare.sender_id, {
        title: dare.recipient_username, body: 'sent proof for your dare. Tap to review it.', url: '/dares', tag: `dare-${dare.id}`,
      });
      res.json(updated);
    } catch (err) {
      console.error('Submit proof error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.get('/api/dares/:id/proof', authMiddleware, async (req, res) => {
    try {
      if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid dare.' });
      const r = await pool.query(
        `SELECT proof_name, proof_mime, proof_size, proof_data FROM dares
         WHERE id = $1 AND proof_data IS NOT NULL AND (sender_id = $2 OR recipient_id = $2)`,
        [req.params.id, req.userId]);
      if (r.rows.length === 0) return res.status(404).json({ message: 'Proof not found.' });
      const p = r.rows[0];
      res.set({
        'Content-Type': p.proof_mime,
        'Content-Length': p.proof_size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });
      res.send(p.proof_data);
    } catch (err) {
      console.error('Get proof error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/dares/:id/approve', authMiddleware, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid dare.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query('SELECT * FROM dares WHERE id = $1 FOR UPDATE', [req.params.id]);
      const d = r.rows[0];
      if (!d || String(d.sender_id) !== String(req.userId)) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Dare not found.' });
      }
      if (d.status !== 'submitted') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'There is no proof to approve.' });
      }
      await client.query(`UPDATE dares SET status = 'approved', completed_at = NOW() WHERE id = $1`, [d.id]);
      await client.query(
        'INSERT INTO dare_points_log (user_id, dare_id, points) VALUES ($1, $2, $3) ON CONFLICT (dare_id) DO NOTHING',
        [d.recipient_id, d.id, d.points]);
      await client.query('COMMIT');

      const dare = await getDare(d.id);
      ping(dare.sender_id, dare.recipient_id);
      push.sendToUser(dare.recipient_id, {
        title: dare.sender_username, body: `approved your dare +${dare.points} points 🎉`, url: '/dares', tag: `dare-${dare.id}`,
      });
      res.json(dare);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      console.error('Approve dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    } finally {
      client.release();
    }
  });

  app.post('/api/dares/:id/redo', authMiddleware, async (req, res) => {
    try {
      const dare = await loadForParticipant(req, res);
      if (!dare) return;
      if (String(dare.sender_id) !== String(req.userId)) return res.status(403).json({ message: 'Only the sender can ask for another try.' });
      if (dare.status !== 'submitted') return res.status(409).json({ message: 'There is no proof to review.' });

      await pool.query(
        `UPDATE dares
         SET status = 'accepted', submitted_at = NULL, expires_at = NOW() + make_interval(mins => time_limit_minutes),
             proof_name = NULL, proof_mime = NULL, proof_size = NULL, proof_data = NULL, proof_note = NULL
         WHERE id = $1 AND status = 'submitted'`, [dare.id]);
      ping(dare.sender_id, dare.recipient_id);
      push.sendToUser(dare.recipient_id, {
        title: dare.sender_username, body: 'asked for another try. You have more time.', url: '/dares', tag: `dare-${dare.id}`,
      });
      res.json(await getDare(dare.id));
    } catch (err) {
      console.error('Redo dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  app.post('/api/dares/:id/report', authMiddleware, async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
    if (reason.length < 3) return res.status(400).json({ message: 'Tell us briefly what is wrong.' });
    try {
      const dare = await loadForParticipant(req, res);
      if (!dare) return;
      await pool.query('INSERT INTO dare_reports (dare_id, reporter_id, reason) VALUES ($1, $2, $3)', [dare.id, req.userId, reason]);
      console.log(`[dares] REPORT dare ${dare.id} by user ${req.userId}: ${reason}`);
      // the person who was dared stops seeing it straight away
      if (String(dare.recipient_id) === String(req.userId) && ['pending', 'accepted'].includes(dare.status)) {
        await pool.query(`UPDATE dares SET status = 'declined', completed_at = NOW() WHERE id = $1`, [dare.id]);
        ping(dare.sender_id, dare.recipient_id);
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Report dare error:', err);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  return { initDaresTables, attachIO(socketIo) { io = socketIo; }, isUnsafe };
}

module.exports = { setupDares, isUnsafe, CATEGORIES, TIME_LIMITS };
