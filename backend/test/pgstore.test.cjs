// 用假 Pool 验证 PgStore 的乐观锁 SQL：UPDATE ... WHERE version = $expected
const assert = require('node:assert/strict');
const { PgStore } = require('../src/db');

const row = (over = {}) => ({
  id: '7',
  text: '去西湖',
  created_by: '爸爸',
  completed_by: null,
  completed: false,
  created_at: new Date('2026-09-25T01:00:00Z'),
  updated_at: new Date('2026-09-25T01:00:00Z'),
  completed_at: null,
  version: 1,
  ...over,
});

const makePool = () => {
  const calls = [];
  let nextUpdateResult = { rows: [row({ version: 2, text: '去西湖边走走' })], rowCount: 1 };
  return {
    calls,
    setUpdateResult(result) {
      nextUpdateResult = result;
    },
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.startsWith('UPDATE')) return nextUpdateResult;
      if (sql.startsWith('INSERT')) return { rows: [row()] };
      if (sql.startsWith('DELETE')) return { rowCount: 1 };
      if (sql.includes('WHERE id')) return { rows: [row()] };
      return { rows: [row()] };
    },
    async end() {},
  };
};

(async () => {
  let n = 0;
  const ok = (name, cond) => {
    n += 1;
    assert.ok(cond, name);
    console.log(`  ✓ ${name}`);
  };

  const pool = makePool();
  const store = new PgStore(pool);

  // 正常编辑：SQL 带 version 乐观锁条件，参数包含版本号
  const result = await store.update('7', { text: '去西湖边走走' }, 1);
  const updateCall = pool.calls.find((c) => c.sql.startsWith('UPDATE'));
  ok('UPDATE 语句存在', !!updateCall);
  ok('SQL 含 version 乐观锁条件', /WHERE id = \$\d+::bigint AND version = \$\d+/.test(updateCall.sql));
  ok('SQL 递增 version', updateCall.sql.includes('version = version + 1'));
  ok('SQL 刷新 updated_at', updateCall.sql.includes('updated_at = CURRENT_TIMESTAMP'));
  ok('参数末尾是 id 与期望版本', updateCall.params.slice(-2).join(',') === '7,1');
  ok('编辑成功返回新 wish', result.conflict === false && result.wish.version === 2);

  // 并发冲突：UPDATE 影响 0 行 → 回查当前行 → 返回 conflict
  pool.setUpdateResult({ rows: [], rowCount: 0 });
  const conflicted = await store.update('7', { text: '后提交的内容' }, 1);
  ok('0 行更新判定为冲突', conflicted.conflict === true);
  ok('冲突时回查并返回最新行', conflicted.current.text === '去西湖' && conflicted.current.version === 1);

  // 心愿被删除：0 行更新且回查为空 → null（notFound）
  pool.setUpdateResult({ rows: [], rowCount: 0 });
  pool.calls.length = 0;
  const originalFind = store.find.bind(store);
  store.find = async () => null;
  const missing = await store.update('999', { text: 'x' }, 1);
  store.find = originalFind;
  ok('更新时心愿已删除返回 null', missing === null);

  // 完成操作的字段集
  pool.setUpdateResult({
    rows: [row({ completed: true, completed_by: '爸爸', version: 3, completed_at: new Date() })],
    rowCount: 1,
  });
  await store.update('7', { completed: true, completedBy: '爸爸', completedAt: '2026-09-25T03:00:00.000Z' }, 2);
  const completeCall = pool.calls.filter((c) => c.sql.startsWith('UPDATE')).pop();
  ok('完成 SQL 设置 completed', /completed = \$\d+/.test(completeCall.sql));
  ok('完成 SQL 设置 completed_by', /completed_by = \$\d+/.test(completeCall.sql));
  ok('完成 SQL 设置 completed_at', /completed_at = \$\d+::timestamptz/.test(completeCall.sql));

  // 行映射：字段名与时间格式
  const list = await store.list();
  ok('mapRow 输出驼峰字段与 ISO 时间', list[0].createdBy === '爸爸' && list[0].createdAt === '2026-09-25T01:00:00.000Z');

  console.log(`\nPgStore: ${n} 项检查全部通过`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
