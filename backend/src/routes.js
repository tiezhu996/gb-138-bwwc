const config = require('./config');
const { project, messages } = require('./constants');
const { sendJson } = require('./response');
const { ApiError } = require('./errors');

const MAX_BODY_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 50;

const withCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Family-Member');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('badRequest', '请求内容过大'));
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
        reject(new ApiError('badRequest', '请求体不是有效的 JSON'));
      }
    });
    req.on('error', reject);
  });

// HTTP 头按 latin1 解析：前端会用百分号编码发送 UTF-8 名字，
// 同时兼容直接发送原始 UTF-8 字节的客户端（latin1 误读恢复）
const decodeHeaderValue = (raw) => {
  if (raw.includes('%')) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  if (/[\x80-\xff]/.test(raw)) {
    return Buffer.from(raw, 'latin1').toString('utf8');
  }
  return raw;
};

const getActor = (req) => {
  const name = decodeHeaderValue(String(req.headers['x-family-member'] || '')).trim();
  if (!name) throw new ApiError('unauthorized', '请先填写您的名字');
  if (name.length > MAX_NAME_LENGTH) throw new ApiError('badRequest', '名字过长');
  return name;
};

const createRouter = ({ wishService, eventHub, storeMode }) => {
  const handleRequest = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    withCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.on('error', () => res.destroy());

    try {
      if (url.pathname === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: project.id,
          message: messages.health,
          wishesStorage: storeMode,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (url.pathname === '/api/info') {
        sendJson(res, 200, {
          ...project,
          database: config.database,
        });
        return;
      }

      // SSE：家人在其他设备上的改动会即时推送
      if (req.method === 'GET' && url.pathname === '/api/wishes/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        eventHub.connect(res);
        return;
      }

      if (url.pathname === '/api/wishes') {
        if (req.method === 'GET') {
          const wishes = await wishService.list();
          sendJson(res, 200, { wishes });
          return;
        }
        if (req.method === 'POST') {
          const actor = getActor(req);
          const body = await readBody(req);
          const wish = await wishService.create({ text: body.text, actor });
          sendJson(res, 201, { wish });
          return;
        }
      }

      const completeMatch = url.pathname.match(/^\/api\/wishes\/(\d+)\/complete$/);
      if (completeMatch) {
        if (req.method !== 'POST') throw new ApiError('notFound', messages.notFound);
        const actor = getActor(req);
        const body = await readBody(req);
        const wish = await wishService.complete(completeMatch[1], { version: body.version }, actor);
        sendJson(res, 200, { wish });
        return;
      }

      const wishMatch = url.pathname.match(/^\/api\/wishes\/(\d+)$/);
      if (wishMatch) {
        const id = wishMatch[1];
        if (req.method === 'PATCH') {
          const actor = getActor(req);
          const body = await readBody(req);
          const wish = await wishService.edit(id, { text: body.text, version: body.version }, actor);
          sendJson(res, 200, { wish });
          return;
        }
        if (req.method === 'DELETE') {
          const actor = getActor(req);
          await wishService.remove(id, actor);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      sendJson(res, 404, { error: messages.notFound, path: url.pathname });
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { error: error.code, message: error.message, details: error.details });
        return;
      }
      require('./logger').error(`请求处理失败: ${error.stack || error.message}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal', message: '服务器开小差了，请稍后再试' });
      } else {
        res.destroy();
      }
    }
  };

  return { handleRequest };
};

module.exports = { createRouter };
