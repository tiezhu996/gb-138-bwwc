const db = require('./db');

const mapWish = (row) => ({
  id: String(row.id),
  text: row.text,
  completed: row.completed,
  createdBy: row.created_by,
  completedBy: row.completed_by,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  completedAt:
    row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
  updatedBy: row.updated_by,
  updatedAt:
    row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  version: row.version,
});

const listWishes = async (status) => {
  let sql = 'SELECT * FROM wishes';
  const params = [];
  if (status === 'active') {
    sql += ' WHERE completed = FALSE';
  } else if (status === 'completed') {
    sql += ' WHERE completed = TRUE';
  }
  sql += ' ORDER BY created_at ASC, id ASC';
  const result = await db.query(sql, params);
  return result.rows.map(mapWish);
};

const createWish = async ({ text, createdBy, completed, completedBy, completedAt }) => {
  const result = await db.query(
    `INSERT INTO wishes
       (text, created_by, completed, completed_by, completed_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $2)
     RETURNING *`,
    [
      text,
      createdBy,
      Boolean(completed),
      completed ? completedBy ?? createdBy : null,
      completed && completedAt ? new Date(completedAt) : null,
    ]
  );
  return mapWish(result.rows[0]);
};

/**
 * Conditional update guarded by optimistic-lock version.
 *
 * build(values) returns { sql: fragment, params: [...] } where the
 * fragment is placed after the SET keyword. The UPDATE is restricted to
 * WHERE id = $n AND version = $n so two family members editing the same
 * wish in sequence cannot silently overwrite one another.
 * Returns null when no row matches (missing or stale version).
 */
const updateWish = async (id, expectedVersion, buildSet) => {
  const { fragment, params } = buildSet;
  const result = await db.query(
    `UPDATE wishes
       SET ${fragment}, version = version + 1
     WHERE id = $${params.length + 1} AND version = $${params.length + 2}
     RETURNING *`,
    [...params, id, expectedVersion]
  );
  return result.rows[0] ? mapWish(result.rows[0]) : null;
};

const getWish = async (id) => {
  const result = await db.query('SELECT * FROM wishes WHERE id = $1', [id]);
  return result.rows[0] ? mapWish(result.rows[0]) : null;
};

const deleteWish = async (id) => {
  const result = await db.query('DELETE FROM wishes WHERE id = $1', [id]);
  return result.rowCount > 0;
};

module.exports = {
  listWishes,
  createWish,
  updateWish,
  getWish,
  deleteWish,
};
