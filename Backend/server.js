require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const authMiddleware = require('./authMiddleware');
const { setupPush } = require('./push');
const { setupDares } = require('./dares');

const app = express();
// Render sits behind a proxy: needed so req.ip is the real visitor (used by the rate limiter)
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Web Push + in-app alerts (see push.js)
const push = setupPush(app, pool, authMiddleware);

const { setupLive } = require('./live');
// Dares game (see dares.js)
const dares = setupDares(app, pool, authMiddleware, push);
const live = setupLive(app, pool, authMiddleware, push);

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function parseAttachment(value) {
  if (!value || typeof value !== 'object' || typeof value.data !== 'string') {
    throw new Error('Invalid attachment.');
  }

  const dataUrl = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.data);
  if (!dataUrl) throw new Error('Invalid attachment data.');

  const buffer = Buffer.from(dataUrl[2], 'base64');
  if (buffer.toString('base64') !== dataUrl[2]) throw new Error('Invalid attachment data.');
  if (buffer.length > MAX_ATTACHMENT_SIZE) throw new Error('Attachments must be 10 MB or smaller.');

  const fileName = String(value.file_name || 'attachment')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 180) || 'attachment';
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(dataUrl[1])
    ? dataUrl[1].toLowerCase()
    : 'application/octet-stream';

  return { fileName, mimeType, buffer };
}

async function saveAttachment(messageId, attachment, db = pool) {
  if (!attachment) return null;
  const result = await db.query(
    `INSERT INTO message_attachments (message_id, file_name, mime_type, file_size, data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING file_name, mime_type, file_size`,
    [messageId, attachment.fileName, attachment.mimeType, attachment.buffer.length, attachment.buffer]
  );
  const saved = result.rows[0];
  return {
    file_name: saved.file_name,
    mime_type: saved.mime_type,
    file_size: saved.file_size,
  };
}

async function insertMessage(query, values, attachment) {
  if (!attachment) {
    return { result: await pool.query(query, values), savedAttachment: null };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(query, values);
    const savedAttachment = await saveAttachment(result.rows[0].id, attachment, client);
    await client.query('COMMIT');
    return { result, savedAttachment };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Message attachment rollback error:', rollbackError);
    }
    throw err;
  } finally {
    client.release();
  }
}

function getAttachmentMetadata(row) {
  if (!row.attachment_name) return null;
  return {
    file_name: row.attachment_name,
    mime_type: row.attachment_mime_type,
    file_size: row.attachment_file_size,
  };
}

function orderUserIds(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

// --- AUTH ---

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }
  try {
    const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email ,avatar:user.avatar}
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'An account with that email already exists.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash,avatar)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, avatar`,
      [username, email, passwordHash, null]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- FORGOT / RESET PASSWORD ---

const RESET_TOKEN_MINUTES = 30;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Tiny in-memory rate limiter: `max` requests per `windowMs` for each visitor (IP).
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ message: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

// Sends an email through Brevo's web API (Render's free plan blocks normal SMTP, so we use HTTPS).
// If BREVO_API_KEY isn't set (e.g. on your own computer) the email is printed in the server log instead.
async function sendEmail({ to, subject, text, html }) {
  if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM) {
    console.log(`\n[email not configured - would have sent to ${to}]\nSubject: ${subject}\n${text}\n`);
    return;
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: process.env.MAIL_FROM_NAME || 'Morphues', email: process.env.MAIL_FROM },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Email provider said ${response.status}: ${await response.text()}`);
  }
  const info = await response.json().catch(() => ({}));
  console.log(`Email accepted by Brevo for ${to} (id ${info.messageId || 'n/a'}). Check Brevo > Transactional > Logs for delivery.`);
}

function emailLayout(heading, bodyHtml, buttonText, buttonUrl) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f4f1;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;color:#1c1a20">
    <div style="font-size:22px;font-weight:700;margin-bottom:20px">Morphues</div>
    <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
    <div style="font-size:15px;line-height:1.55;color:#4a4550">${bodyHtml}</div>
    ${buttonUrl ? `<p style="margin:28px 0"><a href="${buttonUrl}" style="background:#ff6a28;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:999px;display:inline-block">${buttonText}</a></p>
    <p style="font-size:12.5px;color:#8b8693;word-break:break-all">Button not working? Paste this link into your browser:<br>${buttonUrl}</p>` : ''}
  </div></div>`;
}

app.post('/api/auth/forgot-password', rateLimit(8, 15 * 60 * 1000), async (req, res) => {
  const email = String(req.body.email || '').trim();
  // Same answer whether or not the account exists, so nobody can use this to find out who has an account
  const reply = () => res.json({ message: 'If an account exists for that email, a reset link is on its way.' });
  if (!email) return res.status(400).json({ message: 'Enter your email address.' });

  try {
    const found = await pool.query('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    const user = found.rows[0];
    if (!user) {
      console.log('Forgot password: no account matches the email that was typed (check for typos).');
      return reply();
    }

    // No more than 3 links per hour for one account
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [user.id]
    );
    if (recent.rows[0].n >= 3) {
      console.log(`Forgot password: skipped for ${user.email}, already asked 3 times in the last hour.`);
      return reply();
    }

    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + make_interval(mins => $3::int))`,
      [user.id, sha256(token), RESET_TOKEN_MINUTES]
    );

    console.log(`Forgot password: creating a reset link for ${user.email}`);
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const link = `${frontend}/reset-password?token=${token}`;
    const text =
      `Hi ${user.username},\n\nSomeone asked to reset your Morphues password. Open this link to choose a new one ` +
      `(it works for ${RESET_TOKEN_MINUTES} minutes):\n\n${link}\n\nIf this wasn't you, you can ignore this email.`;
    const html = emailLayout(
      'Reset your password',
      `Hi ${user.username},<br><br>Someone asked to reset your Morphues password. The link below works for ${RESET_TOKEN_MINUTES} minutes. If this wasn't you, just ignore this email.`,
      'Choose a new password',
      link
    );

    // Send in the background so the page answers straight away
    sendEmail({ to: user.email, subject: 'Reset your Morphues password', text, html }).catch((err) =>
      console.error('Could not send reset email:', err.message)
    );
    return reply();
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// Lets the reset page know straight away if a link is no good (expired, used, or made up)
app.post('/api/auth/reset-password/check', rateLimit(30, 15 * 60 * 1000), async (req, res) => {
  const token = String(req.body.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: 'This reset link is not valid.' });
  try {
    const found = await pool.query(
      `SELECT 1 FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [sha256(token)]
    );
    if (found.rows.length === 0) {
      return res.status(400).json({ message: 'This reset link has expired or was already used.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Reset check error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/auth/reset-password', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: 'This reset link is not valid.' });
  if (password.length < 6) return res.status(400).json({ message: 'Use at least 6 characters for your password.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE: if the link is clicked twice at once, only one of them wins
    const found = await client.query(
      `SELECT id, user_id FROM password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [sha256(token)]
    );
    const reset = found.rows[0];
    if (!reset) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This reset link has expired or was already used.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const updated = await client.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING username, email',
      [hash, reset.user_id]
    );
    // Use up this link and any other links still waiting for the same account
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [reset.user_id]);
    await client.query('COMMIT');

    const user = updated.rows[0];
    sendEmail({
      to: user.email,
      subject: 'Your Morphues password was changed',
      text: `Hi ${user.username},\n\nYour Morphues password was just changed. If this wasn't you, reset it again straight away.`,
      html: emailLayout('Password changed', `Hi ${user.username},<br><br>Your Morphues password was just changed. If this wasn't you, reset it again straight away.`),
    }).catch((err) => console.error('Could not send confirmation email:', err.message));

    return res.json({ message: 'Password updated. You can log in now.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Reset password error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// --Backend 

// --- USERS ---

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, avatar FROM users WHERE id != $1',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/users/:userId/profile', authMiddleware, async (req, res) => {
  const profileUserId = Number(req.params.userId);
  if (!Number.isInteger(profileUserId) || profileUserId <= 0) {
    return res.status(400).json({ message: 'Invalid user ID.' });
  }

  try {
    if (profileUserId !== Number(req.userId)) {
      const friendship = await pool.query(
        `SELECT 1 FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'accepted'`,
        [req.userId, profileUserId]
      );
      if (friendship.rows.length === 0) {
        return res.status(403).json({ message: 'You can only view a friend’s profile.' });
      }
    }

    const [profileResult, postsResult, statusesResult, friendsResult] = await Promise.all([
      pool.query(
        'SELECT id, username, avatar FROM users WHERE id = $1',
        [profileUserId]
      ),
      pool.query(
        `SELECT p.id, p.caption, p.image_url, p.created_at,
                u.id AS user_id, u.username, u.avatar,
                COUNT(DISTINCT pl.user_id)::int AS like_count,
                COUNT(DISTINCT pc.id)::int AS comment_count,
                COALESCE(BOOL_OR(pl.user_id = $1), FALSE) AS liked_by_me
         FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN post_likes pl ON pl.post_id = p.id
         LEFT JOIN post_comments pc ON pc.post_id = p.id
         WHERE p.user_id = $2
         GROUP BY p.id, u.id
         ORDER BY p.created_at DESC`,
        [req.userId, profileUserId]
      ),
      pool.query(
        `SELECT s.id, s.content, s.image_url, s.background_color, s.created_at,
                u.id AS user_id, u.username, u.avatar,
                EXISTS (
                  SELECT 1 FROM status_views sv
                  WHERE sv.status_id = s.id AND sv.viewer_id = $1
                ) AS viewed_by_me
         FROM statuses s
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = $2 AND s.created_at > NOW() - INTERVAL '24 hours'
         ORDER BY s.created_at DESC`,
        [req.userId, profileUserId]
      ),
      pool.query(
        `SELECT u.id, u.username, u.avatar
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
         WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
         ORDER BY u.username`,
        [profileUserId]
      ),
    ]);

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({
      user: profileResult.rows[0],
      posts: postsResult.rows,
      statuses: statusesResult.rows,
      friends: friendsResult.rows,
      friendCount: friendsResult.rows.length,
    });
  } catch (err) {
    console.error('Get user profile error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/users/:userId/friends', authMiddleware, async (req, res) => {
  const profileUserId = Number(req.params.userId);
  if (!Number.isInteger(profileUserId) || profileUserId <= 0) {
    return res.status(400).json({ message: 'Invalid user ID.' });
  }

  try {
    if (profileUserId !== Number(req.userId)) {
      const friendship = await pool.query(
        `SELECT 1 FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'accepted'`,
        [req.userId, profileUserId]
      );
      if (friendship.rows.length === 0) {
        return res.status(403).json({ message: 'You can only view a friend’s friends.' });
      }
    }

    const friends = await pool.query(
      `SELECT u.id, u.username, u.avatar
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
       ORDER BY u.username`,
      [profileUserId]
    );
    res.json(friends.rows);
  } catch (err) {
    console.error('Get user friends error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- CONVERSATIONS ---

app.post('/api/conversations', authMiddleware, async (req, res) => {
  const otherUserId = Number(req.body.otherUserId);
  if (!otherUserId) {
    return res.status(400).json({ message: 'otherUserId is required.' });
  }
  if (otherUserId === req.userId) {
    return res.status(400).json({ message: "You can't message yourself." });
  }

  const [userOneId, userTwoId] = orderUserIds(req.userId, otherUserId);

  try {
    // only friends can start a conversation
    const friendship = await pool.query(
      `SELECT 1 FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
      [req.userId, otherUserId]
    );
    if (friendship.rows.length === 0) {
      return res.status(403).json({ message: 'You must be friends to start a conversation.' });
    }

    // reuse the conversation if it already exists
    const existing = await pool.query(
      `SELECT * FROM conversations WHERE user_one_id = $1 AND user_two_id = $2 LIMIT 1`,
      [userOneId, userTwoId]
    );
    if (existing.rows.length > 0) {
      return res.status(200).json(existing.rows[0]);
    }

    try {
      const created = await pool.query(
        `INSERT INTO conversations (user_one_id, user_two_id) VALUES ($1, $2) RETURNING *`,
        [userOneId, userTwoId]
      );
      return res.status(201).json(created.rows[0]);
    } catch (insertError) {
      // 23505 = unique violation: another request created it a moment ago
      if (insertError.code !== '23505') throw insertError;
      const again = await pool.query(
        `SELECT * FROM conversations WHERE user_one_id = $1 AND user_two_id = $2 LIMIT 1`,
        [userOneId, userTwoId]
      );
      return res.status(200).json(again.rows[0]);
    }
  } catch (err) {
    console.error('Conversation error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         c.id AS conversation_id,
         CASE WHEN c.user_one_id = $1 THEN u2.username ELSE u1.username END AS other_username,
         CASE WHEN c.user_one_id = $1 THEN c.user_two_id ELSE c.user_one_id END AS other_user_id,
         CASE WHEN c.user_one_id = $1 THEN u2.avatar ELSE u1.avatar END AS other_user_avatar,
         m.content AS last_message,
         m.created_at AS last_message_at,
         COALESCE(m.user_id != $1 AND m.read_at IS NULL, FALSE) AS last_message_unread,
         COALESCE(unread.unread_count, 0)::int AS unread_count
       FROM conversations c
       JOIN users u1 ON c.user_one_id = u1.id
       JOIN users u2 ON c.user_two_id = u2.id
       LEFT JOIN LATERAL (
         SELECT content, created_at, user_id, read_at
         FROM messages
         WHERE messages.conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread_count
         FROM messages
         WHERE messages.conversation_id = c.id
           AND messages.user_id != $1
           AND messages.read_at IS NULL
       ) unread ON true
       WHERE c.user_one_id = $1 OR c.user_two_id = $1
       ORDER BY m.created_at DESC NULLS LAST`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Send a friend request
app.post('/api/friends/request', authMiddleware, async (req, res) => {
  const { addresseeId } = req.body;
  if (!addresseeId) return res.status(400).json({ message: 'addresseeId is required.' });
  if (addresseeId === req.userId) return res.status(400).json({ message: "You can't friend yourself." });

  try {
    const existing = await pool.query(
      `SELECT * FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, addresseeId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'A friend request already exists.', status: existing.rows[0].status });
    }

    const result = await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, 'pending') RETURNING *`,
      [req.userId, addresseeId]
    );

    const notif = await pool.query(
      `INSERT INTO notifications (user_id, actor_id, type)
       VALUES ($1, $2, 'friend_request') RETURNING *`,
      [addresseeId, req.userId]
    );

    io.to(`user:${addresseeId}`).emit('newNotification', notif.rows[0]);
    io.to(`user:${addresseeId}`).emit('friendRequestReceived', result.rows[0]); // keep this too, Requests page still needs it
    push.nameOf(req.userId).then((name) =>
      push.sendToUser(addresseeId, { title: name, body: 'sent you a friend request', url: '/requests', tag: `fr-${req.userId}` })
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Respond to a friend request (accept or decline)
app.patch('/api/friends/:friendshipId', authMiddleware, async (req, res) => {
  const { friendshipId } = req.params;
  const { status } = req.body; // 'accepted' or 'declined'

  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ message: 'Status must be accepted or declined.' });
  }

  const client = await pool.connect();
  let acceptedConversationMessage = null;
  let acceptedConversationId = null;
  let requesterId = null;

  try {
    await client.query('BEGIN');

    // only the addressee can respond to a request sent to them
    const result = await client.query(
      `UPDATE friendships SET status = $1
       WHERE id = $2 AND addressee_id = $3 AND status = 'pending'
       RETURNING *`,
      [status, friendshipId, req.userId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Request not found or already handled.' });
    }

    const updated = result.rows[0];
    requesterId = updated.requester_id;

    if (status === 'accepted') {
      const [userOneId, userTwoId] = orderUserIds(Number(req.userId), Number(requesterId));
      const insertedConversation = await client.query(
        `INSERT INTO conversations (user_one_id, user_two_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [userOneId, userTwoId]
      );
      const conversationId = insertedConversation.rows[0]?.id
        ?? (await client.query(
          `SELECT id FROM conversations WHERE user_one_id = $1 AND user_two_id = $2`,
          [userOneId, userTwoId]
        )).rows[0]?.id;

      if (!conversationId) {
        throw new Error('Failed to create or find the new friends conversation.');
      }

      const accepterResult = await client.query(
        'SELECT username, avatar FROM users WHERE id = $1',
        [req.userId]
      );
      const messageContent = "You're now friends. Say hello!";
      const messageResult = await client.query(
        `INSERT INTO messages (content, user_id, conversation_id)
         VALUES ($1, $2, $3)
         RETURNING id, content, created_at, reply_to_id`,
        [messageContent, req.userId, conversationId]
      );

      acceptedConversationId = conversationId;
      acceptedConversationMessage = {
        ...messageResult.rows[0],
        username: accepterResult.rows[0].username,
        avatar: accepterResult.rows[0].avatar,
        user_id: req.userId,
        read_at: null,
        conversationId: Number(conversationId),
      };
    }

    await client.query('COMMIT');
    io.to(`user:${requesterId}`).emit('friendRequestResponded', updated);
    if (status === 'accepted') {
      push.nameOf(req.userId).then((name) =>
        push.sendToUser(requesterId, { title: name, body: 'accepted your friend request', url: '/chat', tag: `fra-${req.userId}` })
      );
    }

    if (status === 'accepted') {
      io.to(`conversation:${acceptedConversationId}`).emit('newMessage', acceptedConversationMessage);
      io.to(`user:${req.userId}`).emit('conversationCreated');
      io.to(`user:${requesterId}`).emit('conversationCreated');
      io.to(`user:${requesterId}`).emit('unreadMessagesChanged');
    }

    res.json(updated);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Friend request rollback error:', rollbackError);
    }
    console.error('Respond to request error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// List my friends (accepted only) and anyone I could still friend
app.get('/api/friends', authMiddleware, async (req, res) => {
  try {
    const friends = await pool.query(
      `SELECT u.id, u.username, u.avatar  
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'`,
      [req.userId]
    );
    res.json(friends.rows);
  } catch (err) {
    console.error('Get friends error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/friends/:friendId', authMiddleware, async (req, res) => {
  const friendId = Number(req.params.friendId);
  if (!Number.isInteger(friendId) || friendId <= 0 || friendId === Number(req.userId)) {
    return res.status(400).json({ message: 'Invalid friend ID.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'
       RETURNING id`,
      [req.userId, friendId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Friendship not found.' });
    }
    res.json({ message: 'Friend removed.' });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// List pending requests sent TO me
app.get('/api/friends/requests', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id AS friendship_id, u.id AS requester_id, u.username, u.avatar
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get requests error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- MESSAGES (scoped to a conversation) ---

app.post('/api/conversations/:conversationId/messages', authMiddleware, async (req, res) => {
  const { conversationId } = req.params;
  const { content, replyToId } = req.body;
  let messageContent = content;
  let attachment = null;
  try {
    if (req.body.attachment !== undefined) attachment = parseAttachment(req.body.attachment);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
  if ((!content || !content.trim()) && !attachment) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }
  if (attachment && (!messageContent || !messageContent.trim())) {
    messageContent = `📎 ${attachment.fileName}`;
  }

  try {
    if (attachment) {
      const membership = await pool.query(
        `SELECT 1 FROM conversations
         WHERE id = $1 AND (user_one_id = $2 OR user_two_id = $2)`,
        [conversationId, req.userId]
      );
      if (membership.rows.length === 0) {
        return res.status(403).json({ message: 'You are not a member of this conversation.' });
      }
    }

    const { result, savedAttachment } = await insertMessage(
      `WITH inserted AS (
         INSERT INTO messages (content, user_id, conversation_id, reply_to_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, content, created_at, reply_to_id
       )
       SELECT inserted.*, r.content AS reply_content, ru.username AS reply_username
       FROM inserted
       LEFT JOIN messages r ON inserted.reply_to_id = r.id
       LEFT JOIN users ru ON r.user_id = ru.id`,
      [messageContent, req.userId, conversationId, replyToId || null],
      attachment
    );

    const userResult = await pool.query('SELECT username, avatar FROM users WHERE id = $1', [req.userId]);
    const fullMessage = {
      ...result.rows[0],
      attachment: savedAttachment,
      username: userResult.rows[0].username,
      avatar: userResult.rows[0].avatar,
      user_id: req.userId,
      read_at: null,
      conversationId: Number(conversationId),
    };

    io.to(`conversation:${conversationId}`).emit('newMessage', fullMessage);

    // Tell the OTHER person's browser to refresh their unread badge.
    const convo = await pool.query(
      'SELECT user_one_id, user_two_id FROM conversations WHERE id = $1',
      [conversationId]
    );
    if (convo.rows.length > 0) {
      const { user_one_id, user_two_id } = convo.rows[0];
      const recipientId = user_one_id === req.userId ? user_two_id : user_one_id;
      io.to(`user:${recipientId}`).emit('unreadMessagesChanged');
      push.sendToUser(recipientId, {
        title: fullMessage.username,
        body: push.preview(fullMessage),
        url: `/chat/${conversationId}`,
        tag: `chat-${conversationId}`,
      });
    }

    res.status(201).json(fullMessage);
  } catch (err) {
    console.error('Post message error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/conversations/:conversationId/messages', authMiddleware, async (req, res) => {
  const { conversationId } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
         m.id, m.content, m.created_at, m.read_at, m.edited_at, m.user_id, m.reply_to_id,
         u.username,
         u.avatar AS user_avatar,     
         r.content AS reply_content,
         ru.username AS reply_username,
         a.file_name AS attachment_name,
         a.mime_type AS attachment_mime_type,
         a.file_size AS attachment_file_size
       FROM messages m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN messages r ON m.reply_to_id = r.id
       LEFT JOIN users ru ON r.user_id = ru.id
       LEFT JOIN message_attachments a ON a.message_id = m.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );
    res.json(result.rows.map((row) => ({ ...row, attachment: getAttachmentMetadata(row) })));
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/messages/:messageId/attachment', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.file_name, a.mime_type, a.file_size, a.data
       FROM message_attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE m.id = $1
         AND (
           (m.conversation_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM conversations c
             WHERE c.id = m.conversation_id
               AND (c.user_one_id = $2 OR c.user_two_id = $2)
           ))
           OR (m.group_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM group_members gm
             WHERE gm.group_id = m.group_id AND gm.user_id = $2
           ))
         )`,
      [req.params.messageId, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Attachment not found.' });
    }

    const attachment = result.rows[0];
    const fallbackName = attachment.file_name.replace(/[^\x20-\x7E]|["\\]/g, '_');
    res.set({
      'Content-Type': attachment.mime_type,
      'Content-Length': attachment.file_size,
      'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(attachment.data);
  } catch (err) {
    console.error('Get message attachment error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Total unread DMs for the Messages badge
app.get('/api/messages/unread-count', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.user_one_id = $1 OR c.user_two_id = $1)
         AND m.user_id != $1
         AND m.read_at IS NULL`,
      [req.userId]
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Edit a message — only the sender can edit their own message
app.patch('/api/messages/:messageId', authMiddleware, async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }

  try {
    const result = await pool.query(
      `UPDATE messages
       SET content = $1, edited_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, content, edited_at, conversation_id`,
      [content, messageId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'You can only edit your own messages.' });
    }

    const updated = result.rows[0];
    io.to(`conversation:${updated.conversation_id}`).emit('messageEdited', updated);

    res.json(updated);
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Delete a message — only the sender can delete their own message
app.delete('/api/messages/:messageId', authMiddleware, async (req, res) => {
  const { messageId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM messages WHERE id = $1 AND user_id = $2 RETURNING id, conversation_id`,
      [messageId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'You can only delete your own messages.' });
    }

    const deleted = result.rows[0];
    io.to(`conversation:${deleted.conversation_id}`).emit('messageDeleted', {
      id: deleted.id,
      conversationId: deleted.conversation_id,
    });

    res.status(200).json({ message: 'Message deleted.' });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// --- READ RECEIPTS ---

app.patch('/api/conversations/:conversationId/read', authMiddleware, async (req, res) => {
  const { conversationId } = req.params;
  try {
    await pool.query(
      `UPDATE messages
       SET read_at = NOW()
       WHERE conversation_id = $1
         AND user_id != $2
         AND read_at IS NULL`,
      [conversationId, req.userId]
    );

    io.to(`conversation:${conversationId}`).emit('messagesRead', {
      conversationId: Number(conversationId),
      readerId: req.userId,
    });

    io.to(`user:${req.userId}`).emit('unreadMessagesChanged');

    res.status(200).json({ message: 'Marked as read.' });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
//Create groups
app.post('/api/groups',authMiddleware,async (req,res)=>{
  const {name,memberIds}=req.body;
  if(!name || !name.trim()){
    return res.status(400).json({message:'Groups name is required.'})
  }
  try{
    const group = await pool.query(
      `INSERT INTO groups (name,created_by) VALUES ($1,$2) RETURNING *`,
      [name,req.userId]
    )
    const groupId = group.rows[0].id;
    //creator joins automatically
    await pool.query(
      `INSERT INTO group_members (group_id,user_id) VALUES ($1,$2)`,
      [groupId,req.userId]
    )
    //add initial members, but only if they are actually friends 
    if(Array.isArray(memberIds)){
      for (const memberId of memberIds){
        const friendship = await pool.query(
          `SELECT * FROM friendships
           WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
             AND status = 'accepted'`,
          [req.userId, memberId]
        );
        if(friendship.rows.length>0){
          await pool.query(
            `INSERT INTO group_members (group_id,user_id) VALUES ($1,$2)
            ON CONFLICT DO NOTHING`,
            [groupId,memberId]
          )
        }
      }
  }
  res.status(201).json(group.rows[0]);

}catch(err){
console.error('Create group error:',err);
res.status(500).json({message:'Internal server error.'});
  }
})
//listing groups
app.get('/api/groups', authMiddleware, async (req, res) => {
  try{
    const result = await pool.query(
      `SELECT g.id, g.name, g.created_by,
              COUNT(m.id)::int AS message_count,
              COUNT(m.id) FILTER (
                WHERE m.user_id != $1 AND m.read_at IS NULL
              )::int AS unread_count
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN messages m ON m.group_id = g.id
       WHERE gm.user_id = $1
       GROUP BY g.id, g.name, g.created_by
       ORDER BY g.name ASC`,
      [req.userId]
    );
    res.json(result.rows);
  }
  catch (err) {
    console.error('List groups error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
})
//sending group messages
app.post('/api/groups/:groupId/messages', authMiddleware, async (req, res) => {
  const { groupId } = req.params;
  const { content } = req.body;
  let messageContent = content;
  let attachment = null;
  try {
    if (req.body.attachment !== undefined) attachment = parseAttachment(req.body.attachment);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
  if ((!content || !content.trim()) && !attachment) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }
  if (attachment && (!messageContent || !messageContent.trim())) {
    messageContent = `📎 ${attachment.fileName}`;
  }

  try {
    // confirm the sender is actually a member
    const membership = await pool.query(
      `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, req.userId]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ message: 'You are not a member of this group.' });
    }

    const { result, savedAttachment } = await insertMessage(
      `INSERT INTO messages (content, user_id, group_id)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [messageContent, req.userId, groupId],
      attachment
    );

    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.userId]);
    const fullMessage = {
      ...result.rows[0],
      attachment: savedAttachment,
      username: userResult.rows[0].username,
      user_id: req.userId,
      groupId: Number(groupId),
    };

    io.to(`group:${groupId}`).emit('newGroupMessage', fullMessage);

    // alert the other members (group name + who sent it)
    pool.query(
      `SELECT g.name, gm.user_id FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       WHERE gm.group_id = $1 AND gm.user_id <> $2`,
      [groupId, req.userId]
    ).then((r) => {
      if (r.rows.length === 0) return;
      push.sendToUsers(r.rows.map((m) => m.user_id), {
        title: r.rows[0].name,
        body: `${fullMessage.username}: ${push.preview(fullMessage)}`,
        url: `/group/${groupId}`,
        tag: `group-${groupId}`,
      });
    }).catch((err) => console.error('group push error:', err.message));

    res.status(201).json(fullMessage);
  } catch (err) {
    console.error('Post group message error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
//fetching group messages
app.get('/api/groups/:groupId/messages', authMiddleware, async (req, res) => {
  const { groupId } = req.params;
  try {
    const membership = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, req.userId]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ message: 'You are not a member of this group.' });
    }

    await pool.query(
      `UPDATE messages
       SET read_at = NOW()
       WHERE group_id = $1
         AND user_id != $2
         AND read_at IS NULL`,
      [groupId, req.userId]
    );

    const result = await pool.query(
      `SELECT 
         m.id, m.content, m.created_at, m.edited_at, m.user_id, m.reply_to_id,
         u.username,
         r.content AS reply_content,
         ru.username AS reply_username,
         a.file_name AS attachment_name,
         a.mime_type AS attachment_mime_type,
         a.file_size AS attachment_file_size
       FROM messages m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN messages r ON m.reply_to_id = r.id
       LEFT JOIN users ru ON r.user_id = ru.id
       LEFT JOIN message_attachments a ON a.message_id = m.id
       WHERE m.group_id = $1
       ORDER BY m.created_at ASC`,
      [groupId]
    );
    res.json(result.rows.map((row) => ({ ...row, attachment: getAttachmentMetadata(row) })));
  } catch (err) {
    console.error('Get group messages error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Edit a group message — only the sender can edit their own
app.patch('/api/groups/messages/:messageId', authMiddleware, async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }

  try {
    const result = await pool.query(
      `UPDATE messages
       SET content = $1, edited_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, content, edited_at, group_id`,
      [content, messageId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'You can only edit your own messages.' });
    }

    const updated = result.rows[0];
    io.to(`group:${updated.group_id}`).emit('groupMessageEdited', updated);

    res.json(updated);
  } catch (err) {
    console.error('Edit group message error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Delete a group message — only the sender can delete their own
app.delete('/api/groups/messages/:messageId', authMiddleware, async (req, res) => {
  const { messageId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM messages WHERE id = $1 AND user_id = $2 RETURNING id, group_id`,
      [messageId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'You can only delete your own messages.' });
    }

    const deleted = result.rows[0];
    io.to(`group:${deleted.group_id}`).emit('groupMessageDeleted', {
      id: deleted.id,
      groupId: deleted.group_id,
    });

    res.status(200).json({ message: 'Message deleted.' });
  } catch (err) {
    console.error('Delete group message error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Adding profile
app.patch('/api/users/avatar',authMiddleware, async (req,res)=>{
  const {avatar} = req.body

if(!avatar){
  return res.status(404).json({message:'Avatar is required.'})
}
if(avatar.length>7000){
  return res.status(400).json({message:'Avatar is too large.'})
}
try{
  await pool.query('UPDATE users SET avatar = $1 WHERE id = $2',[avatar,req.userId])
  res.status(200).json({message:'Avatar updated successfully.'})
}
catch(err){
  console.error('Update avatar error:', err);
  res.status(500).json({ message: 'Internal server error.' });
}
})
// Update username
app.patch('/api/users/username', authMiddleware, async (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ message: 'Username is required.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, req.userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'That username is already taken.' });
    }
    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, req.userId]);
    res.json({ username });
  } catch (err) {
    console.error('Update username error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update email
app.patch('/api/users/email', authMiddleware, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ message: 'Email is required.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'That email is already in use.' });
    }
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.userId]);
    res.json({ email });
  } catch (err) {
    console.error('Update email error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update password — requires current password for security
app.patch('/api/users/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' });
  }
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.userId]);
    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('Update password error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Create a post
app.post('/api/posts', authMiddleware, async (req, res) => {
  const { caption, imageUrl } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO posts (user_id, caption, image_url) VALUES ($1, $2, $3) RETURNING *`,
      [req.userId, caption || null, imageUrl || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Feed: posts from your friends and yourself, newest first, with like/comment counts
app.get('/api/posts', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         p.id, p.caption, p.image_url, p.created_at,
         u.id AS user_id, u.username, u.avatar,
         COUNT(DISTINCT pl.user_id) AS like_count,
         COUNT(DISTINCT pc.id) AS comment_count,
         BOOL_OR(pl.user_id = $1) AS liked_by_me
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN post_likes pl ON pl.post_id = p.id
       LEFT JOIN post_comments pc ON pc.post_id = p.id
       WHERE p.user_id = $1
          OR p.user_id IN (
            SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
            FROM friendships
            WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
          )
       GROUP BY p.id, u.id
       ORDER BY p.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get feed error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Like / unlike (toggle)
app.post('/api/posts/:postId/like', authMiddleware, async (req, res) => {
  const { postId } = req.params;
  try {
    const existing = await pool.query(
      `SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2`,
      [postId, req.userId]
    );
    if (existing.rows.length > 0) {
      await pool.query(`DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`, [postId, req.userId]);
      return res.json({ liked: false });
    }

    await pool.query(`INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)`, [postId, req.userId]);

    // find out who owns this post, so we know who to notify
    const postResult = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    const postOwnerId = postResult.rows[0]?.user_id;

    // don't notify yourself if you like your own post
    if (postOwnerId && postOwnerId !== req.userId) {
      const notif = await pool.query(
        `INSERT INTO notifications (user_id, actor_id, type, post_id)
         VALUES ($1, $2, 'like', $3) RETURNING *`,
        [postOwnerId, req.userId, postId]
      );
      // push it live, the same way we push new messages
      io.to(`user:${postOwnerId}`).emit('newNotification', notif.rows[0]);
      push.nameOf(req.userId).then((name) =>
        push.sendToUser(postOwnerId, { title: name, body: 'liked your post', url: `/feed#post-${postId}`, tag: `like-${postId}` })
      );
    }

    return res.json({ liked: true });
  } catch (err) {
    console.error('Toggle like error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Add a comment
app.post('/api/posts/:postId/comments', authMiddleware, async (req, res) => {
  const { postId } = req.params;
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'Comment cannot be empty.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, content) VALUES ($1, $2, $3) RETURNING *`,
      [postId, req.userId, content]
    );
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.userId]);

    const postResult = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    const postOwnerId = postResult.rows[0]?.user_id;

    if (postOwnerId && postOwnerId !== req.userId) {
      const notif = await pool.query(
        `INSERT INTO notifications (user_id, actor_id, type, post_id)
         VALUES ($1, $2, 'comment', $3) RETURNING *`,
        [postOwnerId, req.userId, postId]
      );
      io.to(`user:${postOwnerId}`).emit('newNotification', notif.rows[0]);
      push.sendToUser(postOwnerId, {
        title: userResult.rows[0].username,
        body: 'commented on your post',
        url: `/feed#post-${postId}`,
        tag: `comment-${postId}`,
      });
    }

    res.status(201).json({ ...result.rows[0], username: userResult.rows[0].username });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Get comments for a post
app.get('/api/posts/:postId/comments', authMiddleware, async (req, res) => {
  const { postId } = req.params;
  try {
    const result = await pool.query(
      `SELECT pc.id, pc.content, pc.created_at, u.username
       FROM post_comments pc
       JOIN users u ON pc.user_id = u.id
       WHERE pc.post_id = $1
       ORDER BY pc.created_at ASC`,
      [postId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/posts/:postId', authMiddleware, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const ownedPost = await client.query(
      'SELECT id FROM posts WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.postId, req.userId]
    );
    if (ownedPost.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Post not found.' });
    }

    await client.query('DELETE FROM post_likes WHERE post_id = $1', [req.params.postId]);
    await client.query('DELETE FROM post_comments WHERE post_id = $1', [req.params.postId]);
    await client.query('DELETE FROM notifications WHERE post_id = $1', [req.params.postId]);
    await client.query('DELETE FROM posts WHERE id = $1 AND user_id = $2', [req.params.postId, req.userId]);
    await client.query('COMMIT');
    res.status(200).json({ message: 'Post deleted.' });
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Delete post rollback error:', rollbackError);
    }
    console.error('Delete post error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    if (client) client.release();
  }
});

// Create a status
app.post('/api/statuses', authMiddleware, async (req, res) => {
  const { content, imageUrl, backgroundColor } = req.body;
  if (!content && !imageUrl) {
    return res.status(400).json({ message: 'Status needs text or an image.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO statuses (user_id, content, image_url, background_color)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.userId, content || null, imageUrl || null, backgroundColor || '#4C3BCF']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create status error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Get active statuses from me + my friends, grouped by user
app.get('/api/statuses', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.content, s.image_url, s.background_color, s.created_at,
              u.id AS user_id, u.username, u.avatar,
              EXISTS (
                SELECT 1 FROM status_views sv WHERE sv.status_id = s.id AND sv.viewer_id = $1
              ) AS viewed_by_me
       FROM statuses s
       JOIN users u ON s.user_id = u.id
       WHERE s.created_at > NOW() - INTERVAL '24 hours'
         AND (
           s.user_id = $1
           OR s.user_id IN (
             SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
             FROM friendships
             WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
           )
         )
       ORDER BY s.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get statuses error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/statuses/:statusId', authMiddleware, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const ownedStatus = await client.query(
      'SELECT id FROM statuses WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.statusId, req.userId]
    );
    if (ownedStatus.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Status not found.' });
    }

    await client.query('DELETE FROM status_views WHERE status_id = $1', [req.params.statusId]);
    await client.query('DELETE FROM statuses WHERE id = $1 AND user_id = $2', [req.params.statusId, req.userId]);
    await client.query('COMMIT');
    res.status(200).json({ message: 'Status deleted.' });
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Delete status rollback error:', rollbackError);
    }
    console.error('Delete status error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    if (client) client.release();
  }
});

// Mark a status as viewed
app.post('/api/statuses/:statusId/view', authMiddleware, async (req, res) => {
  const { statusId } = req.params;
  try {
    await pool.query(
      `INSERT INTO status_views (status_id, viewer_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [statusId, req.userId]
    );
    res.status(200).json({ message: 'Marked as viewed.' });
  } catch (err) {
    console.error('Mark status viewed error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
app.get('/api/unread-counts', authMiddleware, async (req, res) => {
  try {
    const [messages, notifications] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.read_at IS NULL
           AND m.user_id != $1
           AND (c.user_one_id = $1 OR c.user_two_id = $1)`,
        [req.userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE user_id = $1 AND read = FALSE`,
        [req.userId]
      ),
    ]);

    res.json({
      messages: messages.rows[0].count,
      notifications: notifications.rows[0].count,
    });
  } catch (err) {
    console.error('Get unread counts error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

//notifications
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.id, n.type, n.read, n.created_at, n.post_id,
              u.id AS actor_id, u.username AS actor_username, u.avatar AS actor_avatar
       FROM notifications n
       JOIN users u ON n.actor_id = u.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.patch('/api/notifications/read', authMiddleware, async (req, res) => {
  try {
    await pool.query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`, [req.userId]);
    io.to(`user:${req.userId}`).emit('notificationsChanged');
    res.status(200).json({ message: 'Marked all as read.' });
  } catch (err) {
    console.error('Mark notifications read error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.patch('/api/notifications/:notificationId/read', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications
       SET read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.notificationId, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found.' });
    }
    io.to(`user:${req.userId}`).emit('notificationsChanged');
    res.status(200).json({ message: 'Notification marked as read.' });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// --- SOCKET.IO SETUP ---

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});
push.attachIO(io);
dares.attachIO(io);
live.attachIO(io);

const onlineUsers = new Map();

// --- VIDEO CALL BOOKKEEPING ---
// userId -> { peerId, callerId, socketId } while a call is ringing or connected.
// Both people in a call get an entry, so we can tell "busy" and block fake events.
const callState = new Map();

// Remove both sides of a call. Returns the other person's id (or null).
function clearCall(userId) {
  const st = callState.get(userId);
  if (!st) return null;
  callState.delete(userId);
  callState.delete(st.peerId);
  return st.peerId;
}

// Seconds -> "02:35" (or "1:02:35" for long calls)
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Save a "call log" message in the chat so both people see what happened.
// outcome: 'completed' (with seconds), 'declined', or 'missed'
async function logCall(callerId, calleeId, outcome, seconds = 0) {
  try {
    const [userOneId, userTwoId] = orderUserIds(Number(callerId), Number(calleeId));
    const convo = await pool.query(
      'SELECT id FROM conversations WHERE user_one_id = $1 AND user_two_id = $2',
      [userOneId, userTwoId]
    );
    if (convo.rows.length === 0) return;
    const conversationId = convo.rows[0].id;

    let content = 'Missed video call';
    if (outcome === 'completed') content = `Video call · ${formatDuration(seconds)}`;
    if (outcome === 'declined') content = 'Video call declined';

    // A missed call stays "unread" for the person who missed it.
    // Calls that were answered or declined were already seen by both people.
    const alreadySeen = outcome !== 'missed';
    const inserted = await pool.query(
      `INSERT INTO messages (content, user_id, conversation_id, read_at)
       VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN NOW() ELSE NULL END)
       RETURNING id, content, created_at, read_at, reply_to_id`,
      [content, callerId, conversationId, alreadySeen]
    );
    const caller = await pool.query('SELECT username, avatar FROM users WHERE id = $1', [callerId]);

    io.to(`conversation:${conversationId}`).emit('newMessage', {
      ...inserted.rows[0],
      username: caller.rows[0].username,
      avatar: caller.rows[0].avatar,
      user_id: callerId,
      conversationId: Number(conversationId),
    });
    // refresh both people's chat lists and unread badges
    io.to(`user:${callerId}`).emit('unreadMessagesChanged');
    io.to(`user:${calleeId}`).emit('unreadMessagesChanged');
  } catch (err) {
    console.error('logCall error:', err);
  }
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('No token provided'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  console.log('New connection, userId:', userId);

  const count = onlineUsers.get(userId) || 0;
  onlineUsers.set(userId, count + 1);

  if (count === 0) {
    io.emit('userOnline', userId);
  }

  socket.emit('onlineUsers', Array.from(onlineUsers.keys()));

  socket.on('joinConversation', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
  });
socket.join(`user:${userId}`);
  socket.on('disconnect', () => {
    // If the tab that was IN a call closes, tell the other person.
    const st = callState.get(userId);
    if (st && st.socketId === socket.id) {
      const callerId = st.callerId;
      const calleeId = callerId === userId ? st.peerId : userId;
      const peerId = clearCall(userId);
      io.to(`user:${peerId}`).emit('call:ended', { fromUserId: userId });
      if (st.acceptedAt) logCall(callerId, calleeId, 'completed', (Date.now() - st.acceptedAt) / 1000);
      else logCall(callerId, calleeId, 'missed');
    }
    const current = onlineUsers.get(userId) || 1;
    if (current <= 1) {
      onlineUsers.delete(userId);
      io.emit('userOffline', userId);
    } else {
      onlineUsers.set(userId, current - 1);
    }
  });
  socket.on('joinGroup', (groupId) => {
  socket.join(`group:${groupId}`);
});
socket.on('typing', ({ conversationId, groupId }) => {
  const room = conversationId ? `conversation:${conversationId}` : `group:${groupId}`;
  socket.to(room).emit('userTyping', { userId: socket.userId, conversationId, groupId });
});

socket.on('stopTyping', ({ conversationId, groupId }) => {
  const room = conversationId ? `conversation:${conversationId}` : `group:${groupId}`;
  socket.to(room).emit('userStoppedTyping', { userId: socket.userId, conversationId, groupId });
});

  // ===== VIDEO CALL SIGNALLING =====
  // The server never touches video. It only passes small "introduction" messages
  // between two browsers so they can connect directly to each other.

  // Caller rings someone
  socket.on('call:invite', async ({ toUserId }) => {
    toUserId = Number(toUserId);
    console.log('[call] invite received from', userId, 'to', toUserId);
    if (!toUserId || toUserId === userId) return;
    try {
      const friendship = await pool.query(
        `SELECT 1 FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'accepted'`,
        [userId, toUserId]
      );
      if (friendship.rows.length === 0) {
        console.log('[call] blocked: not friends');
        return socket.emit('call:unavailable', { reason: 'not-friends' });
      }
      if (!onlineUsers.has(toUserId)) {
        console.log('[call] blocked: callee has no open socket');
        return socket.emit('call:unavailable', { reason: 'offline' });
      }
      if (callState.has(userId) || callState.has(toUserId)) {
        console.log('[call] blocked: someone is busy');
        return socket.emit('call:busy');
      }
      // (no await between the check above and these two lines, so two people
      //  calling each other at the same instant can't both get through)
      callState.set(userId, { peerId: toUserId, callerId: userId, socketId: socket.id });
      callState.set(toUserId, { peerId: userId, callerId: userId, socketId: null });

      const me = await pool.query('SELECT username, avatar FROM users WHERE id = $1', [userId]);
      console.log('[call] ringing user', toUserId);
      io.to(`user:${toUserId}`).emit('call:incoming', {
        fromUserId: userId,
        fromUsername: me.rows[0].username,
        fromAvatar: me.rows[0].avatar,
      });
    } catch (err) {
      console.error('call:invite error:', err);
    }
  });

  // Callee picks up
  socket.on('call:accept', ({ toUserId }) => {
    toUserId = Number(toUserId);
    const st = callState.get(userId);
    if (!st || st.callerId !== toUserId) return; // only the person being called can accept
    st.socketId = socket.id;
    st.acceptedAt = Date.now(); // the call clock starts now (both people's entries)
    const callerEntry = callState.get(toUserId);
    if (callerEntry) callerEntry.acceptedAt = st.acceptedAt;
    socket.to(`user:${userId}`).emit('call:handledElsewhere'); // stop ringing in my other tabs
    io.to(`user:${toUserId}`).emit('call:accepted', { fromUserId: userId });
  });

  // Callee declines
  socket.on('call:reject', ({ toUserId }) => {
    toUserId = Number(toUserId);
    const st = callState.get(userId);
    if (!st || st.callerId !== toUserId) return;
    clearCall(userId);
    socket.to(`user:${userId}`).emit('call:handledElsewhere');
    io.to(`user:${toUserId}`).emit('call:rejected', { fromUserId: userId });
    logCall(st.callerId, userId, 'declined');
  });

  // Pass WebRTC "introduction" data (offer / answer / ICE candidates) to the other person
  socket.on('call:signal', ({ toUserId, data }) => {
    toUserId = Number(toUserId);
    const st = callState.get(userId);
    if (!st || st.peerId !== toUserId) return;
    io.to(`user:${toUserId}`).emit('call:signal', { fromUserId: userId, data });
  });

  // Either person hangs up (or the caller gives up ringing)
  socket.on('call:end', ({ toUserId }) => {
    toUserId = Number(toUserId);
    const st = callState.get(userId);
    if (!st || st.peerId !== toUserId) return;
    const callerId = st.callerId;
    const calleeId = callerId === userId ? st.peerId : userId;
    clearCall(userId);
    io.to(`user:${toUserId}`).emit('call:ended', { fromUserId: userId });
    if (st.acceptedAt) logCall(callerId, calleeId, 'completed', (Date.now() - st.acceptedAt) / 1000);
    else logCall(callerId, calleeId, 'missed'); // caller gave up before anyone answered
  });
});

async function startServer() {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS message_attachments (
         message_id BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
         file_name TEXT NOT NULL,
         mime_type TEXT NOT NULL,
         file_size INTEGER NOT NULL,
         data BYTEA NOT NULL
       )`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS password_resets (
         id BIGSERIAL PRIMARY KEY,
         user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         token_hash TEXT NOT NULL UNIQUE,
         expires_at TIMESTAMPTZ NOT NULL,
         used_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await push.initPushTable();
    await dares.initDaresTables();
    await live.initLiveTables();
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize the database tables:', err);
    process.exitCode = 1;
  }
}

startServer();