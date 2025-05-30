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
                // SCOPA ACTIONS
                case 'scopa_play_card':
                    handleScopaPlayCard(ws, data);
                    break;
                case 'scopa_take_cards':
                    handleScopaTakeCards(ws, data);
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

    // CODENAMEZ HANDLERS
    function handlePlayerConnect(ws, data) {
        playerId = data.player.id;
        players[playerId] = {
            id: playerId,
            username: data.player.username,
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
        const gameType = data.game_type || 'codenamez';
        currentRoom = roomCode;

        let gameState = {};
        
        if (gameType === 'codenamez') {
            gameState = {
                phase: 'lobby',
                words: generateWordGrid(),
                redScore: 9,
                blueScore: 8,
                currentTurn: 'red',
                currentClue: null,
                attemptsRemaining: 0,
                gameHistory: []
            };
        } else if (gameType === 'scopa') {
            gameState = {
                phase: 'lobby',
                deck: generateScopaDeck(),
                tableCards: [],
                players: {},
                currentPlayer: 0,
                playerOrder: [],
                round: 1,
                gameHistory: [],
                scores: {}
            };
        }

        rooms[roomCode] = {
            id: roomCode,
            gameType: gameType,
            creator: playerId,
            players: {},
            gameState: gameState,
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
            game_type: gameType,
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
            game_type: rooms[roomCode].gameType,
            is_creator: rooms[roomCode].creator === playerId
        }));

        broadcastRoomUpdate(roomCode);
    }

    function handleSelectRole(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameType !== 'codenamez') return;

        const role = data.role;
        const team = role.includes('red') ? 'red' : 'blue';

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

    function handleStartGame(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.creator !== playerId) return;

        if (room.gameType === 'codenamez') {
            startCodenamezGame(room, ws);
        } else if (room.gameType === 'scopa') {
            startScopaGame(room, ws);
        }
    }

    function startCodenamezGame(room, ws) {
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

        const redSpy = redPlayers.find(p => p.role === 'red-spy');
        const blueSpy = bluePlayers.find(p => p.role === 'blue-spy');

        if (!redSpy || !blueSpy) {
            ws.send(JSON.stringify({
                type: 'start_game_error',
                message: 'Servono spymaster in entrambe le squadre!'
            }));
            return;
        }

        room.gameState.phase = 'waiting_clue';
        room.gameState.currentTurn = 'red';
        room.gameState.currentClue = null;
        room.gameState.attemptsRemaining = 0;
        
        broadcastToRoom(currentRoom, {
            type: 'game_started',
            room: room
        });
    }

    function startScopaGame(room, ws) {
        const playerIds = Object.keys(room.players);
        
        if (playerIds.length < 2 || playerIds.length > 4) {
            ws.send(JSON.stringify({
                type: 'start_game_error',
                message: 'Scopa richiede 2-4 giocatori!'
            }));
            return;
        }

        // Inizializza gioco Scopa
        const deck = generateScopaDeck();
        shuffleDeck(deck);
        
        // 4 carte sul tavolo
        const tableCards = deck.splice(0, 4);
        
        // Inizializza giocatori
        const gameState = room.gameState;
        gameState.phase = 'playing';
        gameState.deck = deck;
        gameState.tableCards = tableCards;
        gameState.playerOrder = playerIds;
        gameState.currentPlayer = 0;
        gameState.round = 1;
        gameState.players = {};
        gameState.scores = {};
        
        // Dai 3 carte a ogni giocatore
        playerIds.forEach(pid => {
            gameState.players[pid] = {
                hand: deck.splice(0, 3),
                captured: [],
                scope: 0
            };
            gameState.scores[pid] = 0;
        });

        broadcastToRoom(currentRoom, {
            type: 'scopa_game_started',
            room: room
        });
    }

    // CODENAMEZ GAME LOGIC
    function handleGiveClue(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameState.phase !== 'waiting_clue') return;

        const player = room.players[playerId];
        const clue = data.clue;

        const expectedRole = room.gameState.currentTurn + '-spy';
        if (player.role !== expectedRole) {
            ws.send(JSON.stringify({
                type: 'clue_error',
                message: 'Non è il tuo turno per dare indizi!'
            }));
            return;
        }

        if (!clue.word || !clue.number || clue.number < 0 || clue.number > 9) {
            ws.send(JSON.stringify({
                type: 'clue_error',
                message: 'Indizio non valido!'
            }));
            return;
        }

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

        room.gameState.currentClue = clue;
        room.gameState.phase = 'guessing';
        room.gameState.attemptsRemaining = clue.number + 1;

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

        if (word.revealed || room.gameState.attemptsRemaining <= 0) return;

        word.revealed = true;
        room.gameState.attemptsRemaining--;

        if (word.color === 'red') {
            room.gameState.redScore--;
        } else if (word.color === 'blue') {
            room.gameState.blueScore--;
        }

        room.gameState.gameHistory.push({
            type: 'word_selected',
            team: room.gameState.currentTurn,
            player: player.username,
            word: word.word,
            color: word.color,
            timestamp: Date.now()
        });

        let gameEnded = false;
        let winner = null;
        let turnEnded = false;
        let reason = 'victory';

        if (word.color === 'assassin') {
            gameEnded = true;
            winner = player.team === 'red' ? 'blue' : 'red';
            reason = 'assassin';
        } else if (room.gameState.redScore === 0) {
            gameEnded = true;
            winner = 'red';
        } else if (room.gameState.blueScore === 0) {
            gameEnded = true;
            winner = 'blue';
        }

        if (!gameEnded) {
            if (word.color !== player.team) {
                turnEnded = true;
            } else if (room.gameState.attemptsRemaining === 0) {
                turnEnded = true;
            }
        }

        if (gameEnded) {
            room.gameState.phase = 'ended';
            broadcastToRoom(currentRoom, {
                type: 'game_ended',
                winner: winner,
                reason: reason,
                room: room
            });
        } else if (turnEnded) {
            changeTurn(room);
            broadcastToRoom(currentRoom, {
                type: 'turn_changed',
                room: room
            });
        } else {
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

        if (player.team !== room.gameState.currentTurn || 
            (player.role && player.role.includes('spy'))) {
            return;
        }

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

    // SCOPA GAME LOGIC
    function handleScopaPlayCard(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameType !== 'scopa' || room.gameState.phase !== 'playing') return;

        const gameState = room.gameState;
        const currentPlayerId = gameState.playerOrder[gameState.currentPlayer];
        
        if (playerId !== currentPlayerId) {
            ws.send(JSON.stringify({
                type: 'scopa_error',
                message: 'Non è il tuo turno!'
            }));
            return;
        }

        const cardIndex = data.card_index;
        const playerHand = gameState.players[playerId].hand;
        
        if (cardIndex < 0 || cardIndex >= playerHand.length) {
            ws.send(JSON.stringify({
                type: 'scopa_error',
                message: 'Carta non valida!'
            }));
            return;
        }

        const playedCard = playerHand.splice(cardIndex, 1)[0];
        
        // Trova possibili prese
        const possibleTakes = findScopaTakes(playedCard, gameState.tableCards);
        
        if (possibleTakes.length > 0) {
            // Il giocatore deve scegliere quale presa fare
            ws.send(JSON.stringify({
                type: 'scopa_choose_take',
                played_card: playedCard,
                possible_takes: possibleTakes,
                room: room
            }));
        } else {
            // Nessuna presa possibile, la carta va sul tavolo
            gameState.tableCards.push(playedCard);
            nextScopaPlayer(room);
            
            broadcastToRoom(currentRoom, {
                type: 'scopa_card_played',
                played_card: playedCard,
                player_id: playerId,
                room: room
            });
        }
    }

    function handleScopaTakeCards(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameType !== 'scopa') return;

        const gameState = room.gameState;
        const playedCard = data.played_card;
        const takenCards = data.taken_cards;
        
        // Verifica che la presa sia valida
        const cardValues = takenCards.map(c => getScopaCardValue(c));
        const totalValue = cardValues.reduce((sum, val) => sum + val, 0);
        
        if (totalValue !== getScopaCardValue(playedCard)) {
            ws.send(JSON.stringify({
                type: 'scopa_error',
                message: 'Presa non valida!'
            }));
            return;
        }

        // Rimuovi carte dal tavolo
        takenCards.forEach(card => {
            const index = gameState.tableCards.findIndex(tc => 
                tc.suit === card.suit && tc.value === card.value
            );
            if (index >= 0) {
                gameState.tableCards.splice(index, 1);
            }
        });

        // Aggiungi carte catturate al giocatore
        gameState.players[playerId].captured.push(playedCard, ...takenCards);
        
        // Controlla SCOPA (tavolo vuoto)
        let isScopa = false;
        if (gameState.tableCards.length === 0) {
            gameState.players[playerId].scope++;
            isScopa = true;
        }

        // Controlla fine mano
        const allHandsEmpty = gameState.playerOrder.every(pid => 
            gameState.players[pid].hand.length === 0
        );

        if (allHandsEmpty) {
            if (gameState.deck.length > 0) {
                // Distribuisci nuove carte
                gameState.playerOrder.forEach(pid => {
                    if (gameState.deck.length > 0) {
                        gameState.players[pid].hand.push(...gameState.deck.splice(0, 3));
                    }
                });
            } else {
                // Fine partita
                endScopaGame(room);
                return;
            }
        }

        nextScopaPlayer(room);

        broadcastToRoom(currentRoom, {
            type: 'scopa_cards_taken',
            played_card: playedCard,
            taken_cards: takenCards,
            player_id: playerId,
            is_scopa: isScopa,
            room: room
        });
    }

    function nextScopaPlayer(room) {
        const gameState = room.gameState;
        gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.playerOrder.length;
    }

    function endScopaGame(room) {
        const gameState = room.gameState;
        
        // Calcola punteggi finali
        const finalScores = calculateScopaScores(gameState);
        
        // Trova vincitore
        let winner = null;
        let maxScore = 0;
        
        Object.entries(finalScores).forEach(([pid, score]) => {
            if (score > maxScore) {
                maxScore = score;
                winner = pid;
            }
        });

        gameState.phase = 'ended';
        gameState.finalScores = finalScores;
        gameState.winner = winner;

        broadcastToRoom(room.id, {
            type: 'scopa_game_ended',
            winner: winner,
            final_scores: finalScores,
            room: room
        });
    }

    // COMMON HANDLERS
    function handleChangeRole(ws, data) {
        const room = rooms[currentRoom];
        if (!room || room.gameType !== 'codenamez') return;

        const role = data.role;
        const team = role.includes('red') ? 'red' : 'blue';

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

        if (room.gameType === 'codenamez') {
            room.gameState.words = generateWordGrid();
            room.gameState.redScore = 9;
            room.gameState.blueScore = 8;
            room.gameState.phase = 'waiting_clue';
            room.gameState.currentTurn = 'red';
            room.gameState.currentClue = null;
            room.gameState.attemptsRemaining = 0;
            room.gameState.gameHistory = [];
        } else if (room.gameType === 'scopa') {
            startScopaGame(room, ws);
            return;
        }

        broadcastToRoom(currentRoom, {
            type: 'game_refreshed',
            room: room
        });
    }

    function handleLeaveRoom(ws, data) {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom].players[playerId];
            
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

// UTILITY FUNCTIONS
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
        "METRO", "TRAM", "BARCA", "YACHT", "CAMION", "FURGONE", "SCOOTER", "SKATEBOARD"
    ];

    const shuffled = [...words].sort(() => Math.random() - 0.5);
    const gameWords = shuffled.slice(0, 25);

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

// SCOPA FUNCTIONS
function generateScopaDeck() {
    const suits = ['coppe', 'denari', 'spade', 'bastoni'];
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const deck = [];

    suits.forEach(suit => {
        values.forEach(value => {
            deck.push({ suit, value });
        });
    });

    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

function getScopaCardValue(card) {
    return card.value;
}

function findScopaTakes(playedCard, tableCards) {
    const playedValue = getScopaCardValue(playedCard);
    const takes = [];

    // Presa singola
    tableCards.forEach((card, index) => {
        if (getScopaCardValue(card) === playedValue) {
            takes.push([index]);
        }
    });

    // Prese multiple (combinazioni che sommano al valore della carta giocata)
    const findCombinations = (cards, target, current = [], start = 0) => {
        if (target === 0) {
            takes.push([...current]);
            return;
        }
        
        for (let i = start; i < cards.length; i++) {
            const cardValue = getScopaCardValue(cards[i]);
            if (cardValue <= target) {
                current.push(i);
                findCombinations(cards, target - cardValue, current, i + 1);
                current.pop();
            }
        }
    };

    findCombinations(tableCards, playedValue);
    
    return takes.filter(take => take.length > 0);
}

function calculateScopaScores(gameState) {
    const scores = {};
    
    gameState.playerOrder.forEach(pid => {
        let score = 0;
        const player = gameState.players[pid];
        
        // Scope
        score += player.scope;
        
        // Carte (chi ne ha di più)
        const cardCount = player.captured.length;
        // TODO: implementa calcolo carte, denari, settebello, primiera
        
        scores[pid] = score;
    });

    return scores;
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
        if (now - players[playerId].lastPing > 60000) {
            const roomCode = players[playerId].room;
            if (roomCode) {
                handlePlayerDisconnect(playerId, roomCode);
            }
        }
    });
}, 30000);

console.log('✅ Server WebSocket Multi-Game configurato completamente!');
