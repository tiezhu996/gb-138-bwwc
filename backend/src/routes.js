const config = require('./config');
const { project, messages } = require('./constants');
const { sendJson } = require('./response');
const db = require('./db');
const wishStore = require('./wishStore');

const MAX_BODY_BYTES = 64 * 1024;
const NAME_MAX_LENGTH = 50;
const TEXT_MAX_LENGTH = 1000;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求内容过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求格式错误'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });

const cleanName = (value) => (typeof value === 'string' ? value.trim() : '');

const fail = (res, status, error, extra) => {
  sendJson(res, status, { error, ...(extra || {}) });
};

const validateActor = (body, req) => {
  const actor = cleanName(body.actor || req.headers['x-actor-name']);
  if (!actor) {
    return { error: '请先填写家人的名字' };
  }
  if (actor.length > NAME_MAX_LENGTH) {
    return { error: `名字不能超过 ${NAME_MAX_LENGTH} 个字符` };
  }
  return { actor };
};

const parseWishId = (value) => Number(value);

const handleHealth = async (res) => {
  try {
    await db.query('SELECT 1');
    sendJson(res, 200, {
      status: 'ok',
      service: project.id,
      message: messages.health,
      database: 'up',
      timestamp: new Date().toISOString(),
    });
  } catch {
    sendJson(res, 503, {
      status: 'error',
      service: project.id,
      database: 'down',
      timestamp: new Date().toISOString(),
    });
  }
};

// GET /api/wishes?status=all|active|completed
const handleListWishes = async (url, res) => {
  const status = url.searchParams.get('status') || 'all';
  if (!['all', 'active', 'completed'].includes(status)) {
    fail(res, 400, '筛选条件无效');
    return;
  }
  const wishes = await wishStore.listWishes(status);
  sendJson(res, 200, { wishes });
};

// POST /api/wishes
const handleCreateWish = async (req, res) => {
  const body = await readBody(req);
  const { actor, error: actorError } = validateActor(body, req);
  if (actorError) {
    fail(res, 400, actorError);
    return;
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    fail(res, 400, '心愿内容不能为空');
    return;
  }
  if (text.length > TEXT_MAX_LENGTH) {
    fail(res, 400, `心愿内容不能超过 ${TEXT_MAX_LENGTH} 个字符`);
    return;
  }
  const wishes = await wishStore.listWishes('all');
  const duplicate = wishes.find((wish) => !wish.completed && wish.text === text);
  if (duplicate) {
    fail(res, 409, '这条心愿已经存在', { wish: duplicate });
    return;
  }
  const imported = body.completed === true && Boolean(body.completedAt);
  const wish = await wishStore.createWish({
    text,
    createdBy: actor,
    completed: imported,
    completedAt: imported ? body.completedAt : null,
  });
  sendJson(res, 201, { wish });
};

// PATCH /api/wishes/:id  — 修改内容或标记完成（带版本号的乐观锁）
const handlePatchWish = async (req, res, idParam) => {
  const id = parseWishId(idParam);
  if (id === null) {
    fail(res, 400, '心愿编号无效');
    return;
  }
  const body = await readBody(req);
  const { actor, error: actorError } = validateActor(body, req);
  if (actorError) {
    fail(res, 400, actorError);
    return;
  }
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    fail(res, 400, '缺少版本号');
    return;
  }

  const current = await wishStore.getWish(id);
  if (!current) {
    fail(res, 404, '这条心愿已不存在');
    return;
  }
  if (current.version !== expectedVersion) {
    fail(res, 409, '这条心愿刚被其他家人修改过，请查看最新内容后再决定', {
      wish: current,
    });
    return;
  }

  const sets = [];
  const params = [];
  const push = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  let touched = false;

  if (typeof body.text === 'string') {
    const text = body.text.trim();
    if (!text) {
      fail(res, 400, '心愿内容不能为空');
      return;
    }
    if (text.length > TEXT_MAX_LENGTH) {
      fail(res, 400, `心愿内容不能超过 ${TEXT_MAX_LENGTH} 个字符`);
      return;
    }
    if (current.createdBy !== actor) {
      fail(res, 403, '只有提出人可以修改这条心愿', { wish: current });
      return;
    }
    if (current.completed) {
      fail(res, 403, '已完成的心愿不能再修改', { wish: current });
      return;
    }
    if (text !== current.text) {
      push('text', text);
      touched = true;
    }
  }

  if (body.completed === true && !current.completed) {
    // 任何家人都可以帮忙标记完成，完成人与时间在此记录
    push('completed', true);
    push('completed_by', actor);
    push('completed_at', new Date());
    touched = true;
  }

  if (!touched) {
    sendJson(res, 200, { wish: current });
    return;
  }

  push('updated_by', actor);
  push('updated_at', new Date());

  const wish = await wishStore.updateWish(id, expectedVersion, {
    fragment: sets.join(', '),
    params,
  });

  if (!wish) {
    const latest = await wishStore.getWish(id);
    if (!latest) {
      fail(res, 404, '这条心愿已不存在');
      return;
    }
    fail(res, 409, '这条心愿刚被其他家人修改过，请查看最新内容后再决定', {
      wish: latest,
    });
    return;
  }
  sendJson(res, 200, { wish });
};

// DELETE /api/wishes/:id  — 仅提出人可撤掉自己未完成的心愿
const handleDeleteWish = async (req, res, idParam) => {
  const id = parseWishId(idParam);
  if (id === null) {
    fail(res, 400, '心愿编号无效');
    return;
  }
  const body = await readBody(req);
  const { actor, error: actorError } = validateActor(body, req);
  if (actorError) {
    fail(res, 400, actorError);
    return;
  }
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    fail(res, 400, '缺少版本号');
    return;
  }

  const current = await wishStore.getWish(id);
  if (!current) {
    fail(res, 404, '这条心愿已不存在');
    return;
  }
  if (current.version !== expectedVersion) {
    fail(res, 409, '这条心愿刚被其他家人修改过，请查看最新内容后再决定', {
      wish: current,
    });
    return;
  }
  if (current.createdBy !== actor) {
    fail(res, 403, '只有提出人可以撤掉这条心愿', { wish: current });
    return;
  }
  if (current.completed) {
    fail(res, 403, '心愿已经完成，不能撤掉', { wish: current });
    return;
  }

  await wishStore.deleteWish(id);
  sendJson(res, 200, { ok: true, id: String(id) });
};

const handleRequest = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  const routeWish = () => {
    const match = pathname.match(/^\/api\/wishes\/(\d+)$/);
    if (!match) {
      return false;
    }
    return match[1];
  };

  (async () => {
    if (pathname === '/api/health') {
      await handleHealth(res);
      return;
    }

    if (pathname === '/api/info') {
      sendJson(res, 200, {
        ...project,
        database: config.database,
      });
      return;
    }

    if (pathname === '/api/wishes' && req.method === 'GET') {
      await handleListWishes(url, res);
      return;
    }

    if (pathname === '/api/wishes' && req.method === 'POST') {
      await handleCreateWish(req, res);
      return;
    }

    const wishId = pathname.startsWith('/api/wishes/') ? routeWish() : false;
    if (wishId) {
      if (req.method === 'PATCH') {
        await handlePatchWish(req, res, wishId);
        return;
      }
      if (req.method === 'DELETE') {
        await handleDeleteWish(req, res, wishId);
        return;
      }
    }

    fail(res, 404, messages.notFound);
  })().catch((err) => {
    const status = err.statusCode || 500;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    if (!res.headersSent) {
      fail(res, status, err.statusCode ? err.message : '服务器开小差了，请稍后再试');
    }
  });
};

module.exports = {
  handleRequest,
};
