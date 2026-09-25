const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', err.message);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const initStatements = [
  `CREATE TABLE IF NOT EXISTS wishes (
    id BIGSERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL,
    completed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wishes_created_at ON wishes (created_at)`,
];

const init = async (attempt = 1) => {
  try {
    for (const statement of initStatements) {
      await pool.query(statement);
    }
    logger.info('Database initialized');
  } catch (err) {
    if (attempt >= 30) {
      throw err;
    }
    logger.error(`Database not ready (attempt ${attempt}), retrying...`, err.message);
    await sleep(2000);
    await init(attempt + 1);
  }
};

const query = (text, params) => pool.query(text, params);

const close = () => pool.end();

module.exports = {
  init,
  query,
  close,
};
