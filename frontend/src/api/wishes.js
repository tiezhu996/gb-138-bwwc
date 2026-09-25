const NAME_KEY = 'familyMemberName';

export const getMemberName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
};

export const saveMemberName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 隐私模式下可能无法存储，仅本次会话有效 */
  }
};

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const request = async (path, { method = 'GET', body } = {}) => {
  const name = getMemberName();
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(name ? { 'X-Family-Member': encodeURIComponent(name) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.error || 'unknown',
      payload?.message || '请求失败，请稍后再试',
      payload?.details,
    );
  }
  return payload;
};

export const fetchWishes = () => request('/api/wishes').then((data) => data.wishes);

export const createWish = (text) =>
  request('/api/wishes', { method: 'POST', body: { text } }).then((data) => data.wish);

export const editWish = (id, text, version) =>
  request(`/api/wishes/${id}`, { method: 'PATCH', body: { text, version } }).then(
    (data) => data.wish,
  );

export const completeWish = (id, version) =>
  request(`/api/wishes/${id}/complete`, { method: 'POST', body: { version } }).then(
    (data) => data.wish,
  );

export const removeWish = (id) => request(`/api/wishes/${id}`, { method: 'DELETE' });

// SSE：服务端在任何心愿变更时推送，前端收到后重新拉取最新清单
export const subscribeWishes = (onChange, onError) => {
  const source = new EventSource('/api/wishes/events');
  source.addEventListener('change', () => onChange());
  source.onerror = () => onError?.();
  return () => source.close();
};

export { ApiError };
