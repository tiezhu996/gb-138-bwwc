const { EventEmitter } = require('node:events');
const config = require('./config');
const logger = require('./logger');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS wishes (
    id BIGSERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    created_by TEXT NOT NULL,
    completed_by TEXT,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1
  )
`;

const SELECT_SQL = `
  SELECT id, text, created_by, completed_by, completed,
         created_at, updated_at, completed_at, version
  FROM wishes
  ORDER BY created_at ASC, id ASC
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const FIND_SQL = `
  SELECT id, text, created_by, completed_by, completed,
         created_at, updated_at, completed_at, version
  FROM wishes
  WHERE id = $1::bigint
`;

const mapRow = (row) => ({
  id: String(row.id),
  text: row.text,
  createdBy: row.created_by,
  completedBy: row.completed_by,
  completed: row.completed,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  completedAt: toIso(row.completed_at),
  version: Number(row.version),
});

class MemoryStore extends EventEmitter {
  constructor() {
    super();
    this.wishes = new Map();
    this.seq = 0;
  }

  async list() {
    return [...this.wishes.values()].sort((a, b) => {
      const byTime = a.createdAt.localeCompare(b.createdAt);
      return byTime !== 0 ? byTime : Number(a.id) - Number(b.id);
    });
  }

  async find(id) {
    const wish = this.wishes.get(id);
    return wish ? { ...wish } : null;
  }

  async create({ text, createdBy }) {
    this.seq += 1;
    const now = new Date().toISOString();
    const wish = {
      id: String(this.seq),
      text,
      createdBy,
      completedBy: null,
      completed: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      version: 1,
    };
    this.wishes.set(wish.id, { ...wish });
    this.emit('change', { type: 'created', wish });
    return wish;
  }

  async update(id, fields, expectedVersion) {
    const current = this.wishes.get(id);
    if (!current) return null;
    if (current.version !== expectedVersion) {
      return { conflict: true, current: { ...current } };
    }
    const next = { ...current, ...fields, updatedAt: new Date().toISOString(), version: current.version + 1 };
    this.wishes.set(id, next);
    this.emit('change', { type: 'updated', wish: { ...next } });
    return { conflict: false, wish: { ...next } };
  }

  async remove(id) {
    const current = this.wishes.get(id);
    if (!current) return null;
    this.wishes.delete(id);
    this.emit('change', { type: 'removed', wish: { ...current } });
    return current;
  }
}

class PgStore extends EventEmitter {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async list() {
    const { rows } = await this.pool.query(SELECT_SQL);
    return rows.map(mapRow);
  }

  async create({ text, createdBy }) {
    const { rows } = await this.pool.query(
      `INSERT INTO wishes (text, created_by) VALUES ($1, $2)
       RETURNING id, text, created_by, completed_by, completed,
                 created_at, updated_at, completed_at, version`,
      [text, createdBy],
    );
    const wish = mapRow(rows[0]);
    this.emit('change', { type: 'created', wish });
    return wish;
  }

  async update(id, fields, expectedVersion) {
    const sets = [];
    const values = [];

    if (fields.text !== undefined) {
      values.push(fields.text);
      sets.push(`text = $${values.length}`);
    }
    if (fields.completed !== undefined) {
      values.push(fields.completed);
      sets.push(`completed = $${values.length}`);
    }
    if (fields.completedBy !== undefined) {
      values.push(fields.completedBy);
      sets.push(`completed_by = $${values.length}`);
    }
    if (fields.completedAt !== undefined) {
      values.push(fields.completedAt ? new Date(fields.completedAt).toISOString() : null);
      sets.push(`completed_at = $${values.length}::timestamptz`);
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    sets.push('version = version + 1');
    values.push(id);
    const idIndex = values.length;
    values.push(expectedVersion);
    const versionIndex = values.length;

    const { rows, rowCount } = await this.pool.query(
      `UPDATE wishes SET ${sets.join(', ')}
       WHERE id = $${idIndex}::bigint AND version = $${versionIndex}
       RETURNING id, text, created_by, completed_by, completed,
                 created_at, updated_at, completed_at, version`,
      values,
    );

    if (rowCount === 0) {
      const current = await this.find(id);
      if (!current) return null;
      return { conflict: true, current };
    }
    const wish = mapRow(rows[0]);
    this.emit('change', { type: 'updated', wish });
    return { conflict: false, wish };
  }

  async find(id) {
    const { rows } = await this.pool.query(FIND_SQL, [id]);
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async remove(id) {
    const current = await this.find(id);
    if (!current) return null;
    await this.pool.query('DELETE FROM wishes WHERE id = $1::bigint', [id]);
    this.emit('change', { type: 'removed', wish: current });
    return current;
  }

  async close() {
    await this.pool.end();
  }
}

const initDb = async () => {
  if (process.env.USE_IN_MEMORY_DB === '1') {
    logger.warn('USE_IN_MEMORY_DB=1：心愿清单使用进程内存存储，重启后数据将丢失');
    return { store: new MemoryStore(), mode: 'memory' };
  }

  let pg;
  try {
    ({ default: pg } = await import('pg'));
  } catch {
    logger.warn('未找到 pg 依赖，心愿清单回退到进程内存存储，重启后数据将丢失');
    return { store: new MemoryStore(), mode: 'memory' };
  }

  const pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: 10,
  });

  const attempt = async (remaining) => {
    try {
      await pool.query(CREATE_TABLE_SQL);
    } catch (error) {
      if (remaining <= 1) throw error;
      logger.warn(`数据库连接失败（${error.message}），2 秒后重试…`);
      await sleep(2000);
      return attempt(remaining - 1);
    }
  };

  try {
    await attempt(5);
  } catch (error) {
    logger.error(`无法连接数据库：${error.message}。心愿清单回退到进程内存存储，重启后数据将丢失`);
    await pool.end().catch(() => {});
    return { store: new MemoryStore(), mode: 'memory' };
  }

  logger.info('心愿清单已使用 PostgreSQL 持久化存储');
  return { store: new PgStore(pool), mode: 'pg' };
};

module.exports = { initDb, PgStore, MemoryStore };
