const http = require('node:http');
const config = require('./config');
const { messages } = require('./constants');
const { handleRequest } = require('./routes');
const db = require('./db');
const logger = require('./logger');

const server = http.createServer(handleRequest);

const start = async () => {
  await db.init();
  server.listen(config.port, config.host, () => {
    logger.info(`${messages.serverStarted} on ${config.port}`);
  });
};

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
