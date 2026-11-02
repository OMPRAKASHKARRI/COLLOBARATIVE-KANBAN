const http = require('http');
const env = require('./config/env');
const prisma = require('./config/db');
const { createApp } = require('./app');
const { initSockets } = require('./sockets');

const server = http.createServer(createApp());
initSockets(server);

server.listen(env.PORT, () => console.log(`API + Socket.IO listening on :${env.PORT} (${env.NODE_ENV})`));

const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
