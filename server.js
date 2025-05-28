const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

// Database in memoria
let rooms = {};
let players = {};

console.log(`🚀 WebSocket Server avviato sulla porta ${PORT}`);

server.on('connection', (ws) => {
    let playerId = null;
    let currentRoom = null;

    console.log('🔗 Nuova connessione WebSocket');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('📨 Messaggio ricevuto:', data.type, data);

            switch (data.type) {
                case 'player_connect':
                    handlePlayerConnect(ws, data);
                    break;
                case 'create_room':
                    handleCreateRoom(ws, data);
                    break;
                case 'join_room':
                    handleJoinRoom(ws, data);
                    break;
                case 'select_role':
                    handleSelectRole(ws, data);
                    break;
                case 'start_game':
                    handleStartGame(ws, data);
                    break;
                case 'give_clue':
                    handleGiveClue(ws, data);
                    break;
                case 'select_word':
                    handleSelectWord(ws, data);
                    break;
                case 'pass_turn':
                    handlePassTurn(ws, data);
                    break;
                case 'change_role':
                    handleChangeRole(ws, data);
                    break;
                case 'refresh_game':
                    handleRefreshGame(ws, data);
                    break;
                case 'leave_room':
                    handleLeaveRoom(ws, data);
                    break;
                case 'ping':
                    handlePing(ws, data);
                    break;
            }
        } catch (error) {
            console.error('❌ Errore parsing messaggio:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Formato messaggio non valido' }));
        }
    });

    ws.on('close', () => {
        console.log('🔌 Connessione chiusa');
        if (playerId && currentRoom) {
            handlePlayerDisconnect(playerId, currentRoom);
        }
    });

    // Funzioni handler
    function handlePlayerConnect(ws, data) {
        playerId = data.player.id;
        players[playerId] = {
            id: playerId,
            username: data.player.username,
            emoji: data.player.emoji,
            ws: ws,
            room: null,
            lastPing: Date.now()
        };

        ws.send(JSON.stringify({
            type: 'player_connected',
            success: true,
            player_id: playerId
        }));
    }

    function handleCreateRoom(ws, data) {
        const roomCode = generateRoomCode();
        currentRoom = roomCode;

        rooms[roomCode] = {
            id: roomCode,
            creator: playerId,
            players: {},
            gameState: {
                phase: 'lobby', // lobby, waiting_clue, guessing, ended
                words: generateWordGrid(),
                redScore: 9,
                blueScore: 8,
                currentTurn: 'red',
                currentClue: null,
                attemptsRemaining: 0,
                gameHistory: []
            },
            createdAt: Date.now()
        };

        // Aggiungi player alla stanza
        rooms[roomCode].players[playerId] = {
            ...players[playerId],
            role: null,
            team: null
        };

        players[playerId].room = roomCode;

        ws.send(JSON.stringify({
            type: 'room_created',
            success: true,
            room_code: roomCode,
            is_creator: true
        }));

        broadcastRoomUpdate(roomCode);
    }

    function handleJoinRoom(ws, data) {
        const roomCode = data.room_code.toUpperCase();

        if (!rooms[roomCode]) {
            ws.send(JSON.stringify({
                type: 'join_room_error',
                message: 'Stanza non trovata'
            }));
            return;
        }

        currentRoom = roomCode;
        
        // Aggiungi player alla stanza
        rooms[roomCode].players[playerId] = {
            ...players[playerId],
            role: null,
            team: null
        };

        players[playerId].room = roomCode;

        ws.send(JSON.stringify({
            type: 'room_joined',
            success: true,
            room_code: roomCode,
            is_creator: rooms[roomCode].creator === playerId
        }));

        broadcastRoomUpdate(roomCode);
    }

    function handleSelectRole(ws, data) {
        const room = rooms[currentRoom];
        if (!room) return;

        const role = data.role;
        const team = role.includes('red') ? 'red' : 'blue';

        // Controlla se ruolo già occupato
        const existingPlayer = Object.values(room.players).find(p => p.role === role);
        if (existingPlayer && existingPlayer.id !== playerId) {
            ws.send(JSON.stringify({
                type: 'role_error',
                message: 'Ruolo già occupato!'
            }));
            return;
        }

        // Assegna ruolo
        room.players[playerId].role = role;
        room.players[playerId].team = team;

        broadcastRoomUpdate(currentRoom);
    }

    function handleStartGame(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.creator !== playerId) return;

        // Controlla se ci sono abbastanza giocatori
        const players = Object.values(room.players);
        const redPlayers = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');

        if (redPlayers.length === 0 || bluePlayers.length === 0) {
            ws.send(JSON.stringify({
                type: 'start_game_error',
                message: 'Servono giocatori in entrambe le squadre!'
            }));
            return;
        }

        // Controlla che ci siano spymaster
        const redSpy = redPlayers.find(p => p.role === 'red-spy');
        const blueSpy = bluePlayers.find(p => p.role === 'blue-spy');

        if (!redSpy || !blueSpy) {
            ws.send(JSON.stringify({
                type: 'start_game_error',
                message: 'Servono spymaster in entrambe le squadre!'
            }));
            return;
        }

        // Inizia il gioco
        room.gameState.phase = 'waiting_clue';
        room.gameState.currentTurn = 'red'; // Iniziano sempre i rossi
        room.gameState.currentClue = null;
        room.gameState.attemptsRemaining = 0;
        
        broadcastToRoom(currentRoom, {
            type: 'game_started',
            room: room
        });
    }

    function handleGiveClue(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameState.phase !== 'waiting_clue') return;

        const player = room.players[playerId];
        const clue = data.clue;

        // Solo lo spymaster del turno corrente può dare indizi
        const expectedRole = room.gameState.currentTurn + '-spy';
        if (player.role !== expectedRole) {
            ws.send(JSON.stringify({
                type: 'clue_error',
                message: 'Non è il tuo turno per dare indizi!'
            }));
            return;
        }

        // Valida indizio
        if (!clue.word || !clue.number || clue.number < 1 || clue.number > 9) {
            ws.send(JSON.stringify({
                type: 'clue_error',
                message: 'Indizio non valido!'
            }));
            return;
        }

        // Controlla che non sia una parola sulla griglia
        const wordExists = room.gameState.words.some(w => 
            w.word.toLowerCase() === clue.word.toLowerCase()
        );
        
        if (wordExists) {
            ws.send(JSON.stringify({
                type: 'clue_error',
                message: 'Non puoi usare una parola presente sulla griglia!'
            }));
            return;
        }

        // Imposta indizio e cambia fase
        room.gameState.currentClue = clue;
        room.gameState.phase = 'guessing';
        room.gameState.attemptsRemaining = clue.number + 1; // N+1 tentativi

        // Aggiungi alla storia
        room.gameState.gameHistory.push({
            type: 'clue',
            team: room.gameState.currentTurn,
            player: player.username,
            clue: clue,
            timestamp: Date.now()
        });

        broadcastToRoom(currentRoom, {
            type: 'clue_given',
            clue: clue,
            room: room
        });
    }

    function handleSelectWord(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameState.phase !== 'guessing') return;

        const player = room.players[playerId];
        const wordIndex = data.word_index;
        const word = room.gameState.words[wordIndex];

        // Validazioni
        if (player.team !== room.gameState.currentTurn) {
            ws.send(JSON.stringify({
                type: 'word_error',
                message: 'Non è il turno della tua squadra!'
            }));
            return;
        }

        if (player.role && player.role.includes('spy')) {
            ws.send(JSON.stringify({
                type: 'word_error',
                message: 'Solo gli agenti possono selezionare!'
            }));
            return;
        }

        if (word.revealed) {
            ws.send(JSON.stringify({
                type: 'word_error',
                message: 'Parola già rivelata!'
            }));
            return;
        }

        if (room.gameState.attemptsRemaining <= 0) {
            ws.send(JSON.stringify({
                type: 'word_error',
                message: 'Tentativi esauriti!'
            }));
            return;
        }

        // Rivela parola
        word.revealed = true;
        room.gameState.attemptsRemaining--;

        // Aggiorna punteggi
        if (word.color === 'red') {
            room.gameState.redScore--;
        } else if (word.color === 'blue') {
            room.gameState.blueScore--;
        }

        // Aggiungi alla storia
        room.gameState.gameHistory.push({
            type: 'word_selected',
            team: room.gameState.currentTurn,
            player: player.username,
            word: word.word,
            color: word.color,
            timestamp: Date.now()
        });

        // Logica di gioco
        let gameEnded = false;
        let winner = null;
        let turnEnded = false;

        // Controlla vittoria/sconfitta
        if (word.color === 'assassin') {
            gameEnded = true;
            winner = player.team === 'red' ? 'blue' : 'red';
        } else if (room.gameState.redScore === 0) {
            gameEnded = true;
            winner = 'red';
        } else if (room.gameState.blueScore === 0) {
            gameEnded = true;
            winner = 'blue';
        }

        // Controlla se il turno deve finire
        if (!gameEnded) {
            if (word.color !== player.team) {
                // Parola sbagliata - turno finito
                turnEnded = true;
            } else if (room.gameState.attemptsRemaining === 0) {
                // Tentativi esauriti - turno finito
                turnEnded = true;
            }
            // Se parola corretta e ci sono ancora tentativi, continua
        }

        if (gameEnded) {
            room.gameState.phase = 'ended';
            broadcastToRoom(currentRoom, {
                type: 'game_ended',
                winner: winner,
                room: room
            });
        } else if (turnEnded) {
            // Cambia turno
            changeTurn(room);
            broadcastToRoom(currentRoom, {
                type: 'turn_changed',
                room: room
            });
        } else {
            // Continua il turno
            broadcastToRoom(currentRoom, {
                type: 'word_selected',
                word_index: wordIndex,
                room: room
            });
        }
    }

    function handlePassTurn(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameState.phase !== 'guessing') return;

        const player = room.players[playerId];

        if (player.team !== room.gameState.currentTurn) {
            ws.send(JSON.stringify({
                type: 'word_error',
                message: 'Non è il turno della tua squadra!'
            }));
            return;
        }

        if (player.role && player.role.includes('spy')) {
            ws.send(JSON.stringify({
                type: 'word_error',
                message: 'Solo gli agenti possono passare il turno!'
            }));
            return;
        }

        // Cambia turno
        changeTurn(room);

        broadcastToRoom(currentRoom, {
            type: 'turn_passed',
            room: room
        });
    }

    function changeTurn(room) {
        room.gameState.currentTurn = room.gameState.currentTurn === 'red' ? 'blue' : 'red';
        room.gameState.phase = 'waiting_clue';
        room.gameState.currentClue = null;
        room.gameState.attemptsRemaining = 0;
    }

    function handleChangeRole(ws, data) {
        const room = rooms[currentRoom];
        if (!room) return;

        const role = data.role;
        const team = role.includes('red') ? 'red' : 'blue';

        // Controlla se ruolo già occupato
        const existingPlayer = Object.values(room.players).find(p => p.role === role);
        if (existingPlayer && existingPlayer.id !== playerId) {
            ws.send(JSON.stringify({
                type: 'role_error',
                message: 'Ruolo già occupato!'
            }));
            return;
        }

        room.players[playerId].role = role;
        room.players[playerId].team = team;

        broadcastRoomUpdate(currentRoom);
    }

    function handleRefreshGame(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.creator !== playerId) return;

        // Reset gioco
        room.gameState.words = generateWordGrid();
        room.gameState.redScore = 9;
        room.gameState.blueScore = 8;
        room.gameState.phase = 'waiting_clue';
        room.gameState.currentTurn = 'red';
        room.gameState.currentClue = null;
        room.gameState.attemptsRemaining = 0;
        room.gameState.gameHistory = [];

        broadcastToRoom(currentRoom, {
            type: 'game_refreshed',
            room: room
        });
    }

    function handleLeaveRoom(ws, data) {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom].players[playerId];
            
            // Se stanza vuota, eliminala
            if (Object.keys(rooms[currentRoom].players).length === 0) {
                delete rooms[currentRoom];
            } else {
                broadcastRoomUpdate(currentRoom);
            }
        }

        if (players[playerId]) {
            players[playerId].room = null;
        }
        currentRoom = null;

        ws.send(JSON.stringify({
            type: 'room_left',
            success: true
        }));
    }

    function handlePing(ws, data) {
        if (players[playerId]) {
            players[playerId].lastPing = Date.now();
        }
        ws.send(JSON.stringify({ type: 'pong' }));
    }

    function handlePlayerDisconnect(playerId, roomCode) {
        if (rooms[roomCode]) {
            delete rooms[roomCode].players[playerId];
            
            if (Object.keys(rooms[roomCode].players).length === 0) {
                delete rooms[roomCode];
            } else {
                broadcastRoomUpdate(roomCode);
            }
        }
        
        delete players[playerId];
    }
});

// Funzioni utility
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateWordGrid() {
    const words = [
        "CASA", "ALBERO", "MARE", "SOLE", "LUNA", "STELLE", "FUOCO", "ACQUA",
        "TERRA", "ARIA", "MONTAGNA", "FIUME", "LAGO", "BOSCO", "DESERTO", "GHIACCIO",
        "NEVE", "PIOGGIA", "VENTO", "NUVOLA", "TEMPORALE", "ARCOBALENO", "FULMINE", "TUONO",
        "GATTO", "CANE", "PESCE", "UCCELLO", "LEONE", "ELEFANTE", "TIGRE", "ORSO",
        "LUPO", "VOLPE", "CONIGLIO", "CAVALLO", "MUCCA", "PECORA", "MAIALE", "POLLO",
        "FIORE", "ROSA", "TULIPANO", "GIRASOLE", "MARGHERITA", "ORCHIDEA", "GIGLIO", "VIOLA",
        "ROSSO", "BLU", "VERDE", "GIALLO", "NERO", "BIANCO", "GRIGIO", "ARANCIONE",
        "VIOLA", "MARRONE", "ORO", "ARGENTO", "BRONZO", "PLATINO", "RAME", "CRISTALLO",
        "AUTO", "TRENO", "AEREO", "NAVE", "BICI", "MOTO", "BUS", "TAXI",
        "METRO", "TRAM", "BARCA", "YACHT", "CAMION", "FURGONE", "SCOOTER", "SKATEBOARD",
        "PANE", "PASTA", "PIZZA", "GELATO", "TORTA", "BISCOTTO", "CIOCCOLATO", "CARAMELLA",
        "FRUTTA", "VERDURA", "CARNE", "PESCE", "LATTE", "FORMAGGIO", "UOVO", "RISO",
        "LIBRO", "PENNA", "MATITA", "QUADERNO", "COMPUTER", "TELEFONO", "TELEVISIONE", "RADIO",
        "MUSICA", "FILM", "GIOCO", "SPORT", "CALCIO", "TENNIS", "BASKET", "NUOTO",
        "AMORE", "PACE", "GUERRA", "TEMPO", "SPAZIO", "VITA", "MORTE", "NASCITA",
        "FAMIGLIA", "AMICO", "NEMICO", "SCUOLA", "LAVORO", "VIAGGIO", "FESTA", "COMPLEANNO",
        "RE", "REGINA", "PRINCIPE", "PRINCIPESSA", "CAVALIERE", "DRAGO", "CASTELLO", "SPADA",
        "SCUDO", "CORONA", "TESORO", "MAPPA", "CHIAVE", "PORTA", "FINESTRA", "PONTE",
        "STRADA", "CITTÀ", "PAESE", "VILLAGGIO", "ISOLA", "CONTINENTE", "MONDO", "UNIVERSO",
        "PIANETA", "SATELLITE", "COMETA", "GALASSIA", "STELLA", "ENERGIA", "FORZA", "POTERE"
    ];

    const shuffled = [...words].sort(() => Math.random() - 0.5);
    const gameWords = shuffled.slice(0, 25);

    // Assegna colori casualmente
    const colors = [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin'
    ];
    colors.sort(() => Math.random() - 0.5);

    return gameWords.map((word, index) => ({
        word: word,
        color: colors[index],
        revealed: false
    }));
}

function broadcastRoomUpdate(roomCode) {
    if (!rooms[roomCode]) return;

    const message = {
        type: 'room_updated',
        room: rooms[roomCode]
    };

    broadcastToRoom(roomCode, message);
}

function broadcastToRoom(roomCode, message) {
    if (!rooms[roomCode]) return;

    Object.values(rooms[roomCode].players).forEach(player => {
        if (players[player.id] && players[player.id].ws && players[player.id].ws.readyState === WebSocket.OPEN) {
            players[player.id].ws.send(JSON.stringify(message));
        }
    });
}

// Cleanup disconnessi ogni 30 secondi
setInterval(() => {
    const now = Date.now();
    Object.keys(players).forEach(playerId => {
        if (now - players[playerId].lastPing > 60000) { // 1 minuto
            const roomCode = players[playerId].room;
            if (roomCode) {
                handlePlayerDisconnect(playerId, roomCode);
            }
        }
    });
}, 30000);

console.log('✅ Server WebSocket Codenamez configurato completamente!');
