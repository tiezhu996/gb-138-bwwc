const http = require('node:http');
const config = require('./config');
const { messages } = require('./constants');
const { initDb } = require('./db');
const { createWishService } = require('./wishService');
const { createEventHub } = require('./events');
const { createRouter } = require('./routes');
const logger = require('./logger');

const start = async () => {
  const { store, mode } = await initDb();
  const wishService = createWishService(store);
  const eventHub = createEventHub(store);
  const { handleRequest } = createRouter({ wishService, eventHub, storeMode: mode });

  const server = http.createServer(handleRequest);

  server.listen(config.port, config.host, () => {
    logger.info(`${messages.serverStarted} on ${config.port}`);
  });

  const shutdown = () => {
    logger.info('服务正在关闭…');
    server.close(() => {
      if (typeof store.close === 'function') {
        store.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start().catch((error) => {
  logger.error(`启动失败: ${error.stack || error.message}`);
  process.exit(1);
});
