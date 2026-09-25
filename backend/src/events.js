// 心愿变更的服务器推送通道（SSE）：家人在其他设备上的改动会实时通知所有打开页面的人
const createEventHub = (store) => {
  const clients = new Set();

  store.on('change', (event) => {
    const data = JSON.stringify({ ...event, at: new Date().toISOString() });
    for (const res of clients) {
      try {
        res.write(`event: change\ndata: ${data}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  });

  const connect = (res) => {
    clients.add(res);
    res.write(': connected\n\n');
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* 客户端已断开，由 close 事件清理 */
      }
    }, 25000);
    res.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
  };

  return { connect };
};

module.exports = { createEventHub };
