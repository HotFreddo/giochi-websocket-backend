const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

console.log(`WebSocket Server avviato sulla porta ${PORT}`);

server.on('connection', (ws) => {
    console.log('Nuova connessione WebSocket');
    
    ws.on('message', (message) => {
        console.log('Messaggio ricevuto:', message.toString());
        ws.send('Connessione OK!');
    });
    
    ws.on('close', () => {
        console.log('Connessione chiusa');
    });
});
