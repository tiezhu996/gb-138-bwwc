// 共享心愿清单 API：数据保存在共同的关怀档案（服务端数据库）中
class ApiError extends Error {
  constructor(message, status, wish) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.wish = wish;
  }
}

const request = async (method, path, actor, body) => {
  const init = { method, headers: {} };
  if (body !== undefined || actor) {
    init.headers['Content-Type'] = 'application/json';
    // 家人名字含中文，HTTP 头部只允许 Latin-1，因此统一放在 JSON 请求体中
    init.body = JSON.stringify({ ...(body || {}), ...(actor ? { actor } : {}) });
  }
  let res;
  try {
    res = await fetch(`/api/wishes${path}`, init);
  } catch {
    throw new ApiError('无法连接关怀档案，请检查网络后重试', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore malformed response
  }

  if (!res.ok) {
    throw new ApiError(data?.error || '请求失败，请稍后再试', res.status, data?.wish);
  }
  return data;
};

export const listWishes = (status = 'all') =>
  request('GET', `?status=${encodeURIComponent(status)}`);

export const createWish = (actor, { text, completed, completedAt }) =>
  request('POST', '', actor, { text, completed, completedAt });

export const updateWish = (actor, id, { text, completed, expectedVersion }) =>
  request('PATCH', `/${id}`, actor, { text, completed, expectedVersion });

export const deleteWish = (actor, id, expectedVersion) =>
  request('DELETE', `/${id}`, actor, { expectedVersion });

export { ApiError };
