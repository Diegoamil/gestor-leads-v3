import { Server } from 'socket.io';
import http from 'http';

export function setupWebSocket(server: http.Server) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Cliente conectado: ${socket.id}`);

    // Entrar na sala da empresa para receber eventos específicos
    socket.on('join:empresa', (empresa_id: string) => {
      socket.join(`empresa:${empresa_id}`);
      console.log(`[WS] ${socket.id} entrou na sala empresa:${empresa_id}`);
    });

    // Sair da sala
    socket.on('leave:empresa', (empresa_id: string) => {
      socket.leave(`empresa:${empresa_id}`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Cliente desconectado: ${socket.id}`);
    });
  });

  console.log('✅ WebSocket (Socket.io) configurado');
  return io;
}
