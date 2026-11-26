const { Client } = require('pg');

const rootConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: 'postgres',
};

const targetDb = process.env.DB_NAME || 'chat_app';

async function ensureDatabase() {
  const adminClient = new Client(rootConfig);
  await adminClient.connect();

  const dbExists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
  if (dbExists.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE "${targetDb}"`);
    console.log(`Created database: ${targetDb}`);
  } else {
    console.log(`Database already exists: ${targetDb}`);
  }

  await adminClient.end();
}

async function initializeSchema() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: targetDb,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      cover_image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_image TEXT;

    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (requester_id, addressee_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      user_one_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_two_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_one_id, user_two_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
      group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      reply_to_id BIGINT REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      data BYTEA NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caption TEXT,
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      image_url TEXT,
      background_color VARCHAR(32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS status_views (
      id BIGSERIAL PRIMARY KEY,
      status_id BIGINT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
      viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (status_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(64) NOT NULL,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
      status_id BIGINT REFERENCES statuses(id) ON DELETE CASCADE,
      comment_id BIGINT REFERENCES post_comments(id) ON DELETE CASCADE,
      conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
      group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships (requester_id, addressee_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_users ON conversations (user_one_id, user_two_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
  `);

  console.log('Database schema initialized successfully.');
  await client.end();
}

async function main() {
  await ensureDatabase();
  await initializeSchema();
}

main().catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});
