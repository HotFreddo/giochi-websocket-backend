// Configurazione WebSocket
const WS_URL = 'wss://giochi-websocket-backend.onrender.com';

// Variabili globali
let currentUser = null;
let ws = null;
let currentRoom = null;
let roomData = null;
let isCreator = false;
let currentAction = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let pingInterval = null;

// Inizializzazione
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Controlla profilo salvato
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        connectWebSocket();
        showHomePage();
    } else {
        showPage('profile-setup');
    }

    initializeEventListeners();
}

function initializeEventListeners() {
    // Save profile - FIX per controllo campi
    document.getElementById('save-profile').addEventListener('click', function() {
        const username = document.getElementById('username').value.trim();
        
        if (!username) {
            showNotification('Inserisci un nome!', 'error');
            return;
        }
        
        if (username.length < 2) {
            showNotification('Il nome deve essere di almeno 2 caratteri!', 'error');
            return;
        }
        
        createUser(username);
        connectWebSocket();
        showHomePage();
    });

    // Save edit profile - FIX per controllo campi
    document.getElementById('save-edit-profile').addEventListener('click', function() {
        const username = document.getElementById('edit-username').value.trim();
        
        if (!username) {
            showNotification('Inserisci un nome!', 'error');
            return;
        }
        
        if (username.length < 2) {
            showNotification('Il nome deve essere di almeno 2 caratteri!', 'error');
            return;
        }
        
        currentUser.username = username;
        currentUser.updatedAt = new Date().toISOString();
        
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        updateUserDisplay();
        showProfile();
        showNotification('Nome aggiornato!', 'success');
    });

    // Enter key per room code
    document.getElementById('room-code').addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && this.value.trim()) {
            joinRoom();
        }
    });

    // Enter key per clue
    document.getElementById('clue-word').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const numberInput = document.getElementById('clue-number');
            if (numberInput.value) {
                giveClue();
            } else {
                numberInput.focus();
            }
        }
    });

    document.getElementById('clue-number').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            giveClue();
        }
    });
}

// WEBSOCKET MANAGEMENT
function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    showLoading('Connettendo al server...');

    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = function() {
            console.log('🔗 WebSocket connesso');
            hideLoading();
            updateConnectionStatus(true);
            reconnectAttempts = 0;

            // Invia dati utente
            if (currentUser) {
                sendMessage({
                    type: 'player_connect',
                    player: currentUser
                });
            }

            // Avvia ping
            startPing();
        };

        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                console.log('📨 Messaggio ricevuto:', data.type, data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('❌ Errore parsing messaggio:', error);
            }
        };

        ws.onclose = function() {
            console.log('🔌 WebSocket disconnesso');
            updateConnectionStatus(false);
            stopPing();
            
            // Tenta riconnessione
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                showLoading(`Riconnettendo... (${reconnectAttempts}/${maxReconnectAttempts})`);
                setTimeout(() => connectWebSocket(), 2000 * reconnectAttempts);
            } else {
                hideLoading();
                showNotification('Connessione persa. Ricarica la pagina.', 'error');
            }
        };

        ws.onerror = function(error) {
            console.error('❌ Errore WebSocket:', error);
            hideLoading();
            showNotification('Errore di connessione', 'error');
        };

    } catch (error) {
        console.error('❌ Errore creazione WebSocket:', error);
        hideLoading();
        showNotification('Impossibile connettersi al server', 'error');
    }
}

function sendMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
        console.log('📤 Messaggio inviato:', data.type, data);
    } else {
        console.error('❌ WebSocket non connesso');
        showNotification('Connessione non disponibile', 'error');
    }
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'player_connected':
            console.log('✅ Player connesso:', data.player_id);
            break;

        case 'room_created':
            handleRoomCreated(data);
            break;

        case 'room_joined':
            handleRoomJoined(data);
            break;

        case 'join_room_error':
            showNotification(data.message, 'error');
            break;

        case 'room_updated':
            handleRoomUpdated(data);
            break;

        case 'role_error':
            showNotification(data.message, 'error');
            break;

        case 'game_started':
            handleGameStarted(data);
            break;

        case 'start_game_error':
            showNotification(data.message, 'error');
            break;

        case 'clue_given':
            handleClueGiven(data);
            break;
            
        case 'clue_error':
            showNotification(data.message, 'error');
            break;

        case 'word_selected':
            handleWordSelected(data);
            break;

        case 'word_error':
            showNotification(data.message, 'error');
            break;

        case 'turn_changed':
            handleTurnChanged(data);
            break;

        case 'turn_passed':
            handleTurnPassed(data);
            break;

        case 'game_ended':
            handleGameEnded(data);
            break;

        case 'game_refreshed':
            handleGameRefreshed(data);
            break;

        case 'room_left':
            handleRoomLeft();
            break;

        case 'pong':
            // Risposta al ping
            break;

        case 'error':
            showNotification(data.message, 'error');
            break;

        default:
            console.log('❓ Messaggio sconosciuto:', data.type);
    }
}

function startPing() {
    stopPing();
    pingInterval = setInterval(() => {
        if (currentRoom) {
            sendMessage({
                type: 'ping',
                room_code: currentRoom
            });
        }
    }, 30000); // Ping ogni 30 secondi
}

function stopPing() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

// USER MANAGEMENT
function createUser(username) {
    currentUser = {
        id: 'user_' + Math.random().toString(36).substr(2, 9),
        username: username,
        createdAt: new Date().toISOString()
    };
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
}

function updateUserDisplay() {
    document.getElementById('user-display').textContent = currentUser.username;
}

function updateConnectionStatus(connected) {
    const status = document.getElementById('connection-status');
    if (status) {
        status.textContent = connected ? '🟢' : '🔴';
    }
}

// PAGE MANAGEMENT
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');
}

function showHomePage() {
    updateUserDisplay();
    showPage('home-page');
    currentRoom = null;
    roomData = null;
    isCreator = false;
}

function showHome() {
    if (currentRoom) {
        leaveRoom();
    } else {
        showHomePage();
    }
}

function showProfile() {
    updateProfileDisplay();
    showPage('profile-page');
}

function updateProfileDisplay() {
    document.getElementById('profile-name').textContent = currentUser.username;
}

function editProfile() {
    document.getElementById('edit-username').value = currentUser.username;
    showPage('edit-profile');
}

function resetProfile() {
    currentAction = () => {
        localStorage.removeItem('currentUser');
        currentUser = null;
        
        if (ws) {
            ws.close();
        }
        
        document.getElementById('username').value = '';
        
        showPage('profile-setup');
    };
    
    showConfirmModal('Sei sicuro di voler resettare il profilo? Tutti i dati verranno persi!');
}

// GAME MANAGEMENT
function startGame(gameName) {
    if (gameName === 'codenamez') {
        showPage('codenamez-setup');
    } else if (gameName === 'culo') {
        showNotification('GAME 2 - CULO: Coming Soon!', 'error');
    } else {
        showNotification('Gioco non ancora disponibile!', 'error');
    }
}

// CODENAMEZ ROOMS
function createRoom() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('Connessione non disponibile', 'error');
        return;
    }

    document.getElementById('create-room-btn').disabled = true;
    
    sendMessage({
        type: 'create_room'
    });
}

function joinRoom() {
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
    
    if (!roomCode) {
        showNotification('Inserisci un codice stanza!', 'error');
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('Connessione non disponibile', 'error');
        return;
    }

    document.getElementById('join-room-btn').disabled = true;
    
    sendMessage({
        type: 'join_room',
        room_code: roomCode
    });
}

function handleRoomCreated(data) {
    document.getElementById('create-room-btn').disabled = false;
    
    if (data.success) {
        currentRoom = data.room_code;
        isCreator = data.is_creator;
        showLobby();
    }
}

function handleRoomJoined(data) {
    document.getElementById('join-room-btn').disabled = false;
    
    if (data.success) {
        currentRoom = data.room_code;
        isCreator = data.is_creator;
        showLobby();
    }
}

function handleRoomUpdated(data) {
    roomData = data.room;
    updateLobby();
    
    // Se siamo in gioco, aggiorna anche quello
    if (document.getElementById('codenamez-game').classList.contains('active')) {
        updateGameDisplay();
    }
}

// LOBBY MANAGEMENT
function showLobby() {
    document.getElementById('lobby-room-code').textContent = currentRoom;
    showPage('codenamez-lobby');
}

function updateLobby() {
    if (!roomData) return;

    // Reset role buttons
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.classList.remove('selected', 'occupied');
        btn.querySelector('.role-status').textContent = '';
    });

    // Update role states
    Object.values(roomData.players).forEach(player => {
        if (player.role) {
            const roleBtn = document.getElementById(`role-${player.role}`);
            if (roleBtn) {
                if (player.id === currentUser.id) {
                    roleBtn.classList.add('selected');
                    roleBtn.querySelector('.role-status').textContent = 'TU';
                } else {
                    roleBtn.classList.add('occupied');
                    roleBtn.querySelector('.role-status').textContent = player.username;
                }
            }
        }
    });

    // Update teams
    updateLobbyTeams();

    // Show start button if creator and teams ready
    if (isCreator) {
        const redPlayers = Object.values(roomData.players).filter(p => p.team === 'red');
        const bluePlayers = Object.values(roomData.players).filter(p => p.team === 'blue');
        
        const startBtn = document.getElementById('start-game-btn');
        if (redPlayers.length > 0 && bluePlayers.length > 0) {
            startBtn.style.display = 'block';
        } else {
            startBtn.style.display = 'none';
        }
    }
}

function updateLobbyTeams() {
    const redList = document.getElementById('lobby-red-players');
    const blueList = document.getElementById('lobby-blue-players');
    
    redList.innerHTML = '';
    blueList.innerHTML = '';

    if (!roomData) return;

    Object.values(roomData.players).forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'lobby-player';
        if (player.role && player.role.includes('spy')) {
            playerDiv.classList.add('spy');
        }

        const roleText = player.role ? 
            (player.role.includes('spy') ? ' (SPY)' : ' (AGENTE)') : '';

        playerDiv.innerHTML = `<span>${player.username}${roleText}</span>`;

        if (player.team === 'red') {
            redList.appendChild(playerDiv);
        } else if (player.team === 'blue') {
            blueList.appendChild(playerDiv);
        }
    });
}

function selectRole(role) {
    const roleBtn = document.getElementById(`role-${role}`);
    
    if (roleBtn.classList.contains('occupied')) {
        showNotification('Ruolo già occupato!', 'error');
        return;
    }

    sendMessage({
        type: 'select_role',
        role: role
    });
}

function startGameFromLobby() {
    if (!isCreator) return;

    sendMessage({
        type: 'start_game'
    });
}

// GAME MANAGEMENT
function handleGameStarted(data) {
    roomData = data.room;
    document.getElementById('current-room-code').textContent = currentRoom;
    
    if (isCreator) {
        document.getElementById('refresh-btn').style.display = 'block';
    }

    initializeGameDisplay();
    showPage('codenamez-game');
}

function initializeGameDisplay() {
    createWordGrid();
    updateScores();
    updateTeams();
    updateGameInterface();
    updateCluesHistory();
}

function updateGameDisplay() {
    createWordGrid();
    updateScores();
    updateTeams();
    updateGameInterface();
    updateCluesHistory();
}

function createWordGrid() {
    const grid = document.getElementById('words-grid');
    grid.innerHTML = '';

    if (!roomData || !roomData.gameState) return;

    roomData.gameState.words.forEach((wordData, index) => {
        const card = document.createElement('div');
        card.className = 'word-card';
        card.textContent = wordData.word;
        card.onclick = () => selectWord(index);

        // Spy view
        const currentPlayerRole = getCurrentPlayerRole();
        if (currentPlayerRole && currentPlayerRole.includes('spy')) {
            card.classList.add('spy-view', wordData.color);
        }

        // Revealed cards
        if (wordData.revealed) {
            card.classList.add('revealed', wordData.color);
        }

        grid.appendChild(card);
    });
}

function getCurrentPlayerRole() {
    if (!roomData || !roomData.players[currentUser.id]) return null;
    return roomData.players[currentUser.id].role;
}

// CLUE AND TURN MANAGEMENT
function giveClue() {
    const word = document.getElementById('clue-word').value.trim().toUpperCase();
    const number = parseInt(document.getElementById('clue-number').value);
    
    if (!word) {
        showNotification('Inserisci una parola!', 'error');
        return;
    }
    
    if (isNaN(number) || number < 0 || number > 9) {
        showNotification('Inserisci un numero da 0 a 9!', 'error');
        return;
    }
    
    // Disabilita il bottone
    document.getElementById('give-clue-btn').disabled = true;
    
    sendMessage({
        type: 'give_clue',
        clue: {
            word: word,
            number: number
        }
    });
    
    // Clear form
    document.getElementById('clue-word').value = '';
    document.getElementById('clue-number').value = '';
    
    // Riabilita dopo 2 secondi
    setTimeout(() => {
        document.getElementById('give-clue-btn').disabled = false;
    }, 2000);
}

function selectWord(index) {
    const currentPlayer = roomData.players[currentUser.id];
    const gameState = roomData.gameState;
    
    // Controlla se può selezionare
    if (currentPlayer.team !== gameState.currentTurn) {
        showNotification('Non è il turno della tua squadra!', 'error');
        return;
    }
    
    if (currentPlayer.role && currentPlayer.role.includes('spy')) {
        showNotification('Solo gli agenti possono selezionare!', 'error');
        return;
    }
    
    if (gameState.phase !== 'guessing') {
        showNotification('Aspetta l\'indizio dello spymaster!', 'error');
        return;
    }
    
    if (gameState.attemptsRemaining <= 0) {
        showNotification('Tentativi esauriti!', 'error');
        return;
    }
    
    if (roomData.gameState.words[index].revealed) return;

    sendMessage({
        type: 'select_word',
        word_index: index
    });
}

function passTurn() {
    currentAction = () => {
        sendMessage({
            type: 'pass_turn'
        });
    };
    
    showConfirmModal('Sei sicuro di voler passare il turno?');
}

function updateGameInterface() {
    if (!roomData || !roomData.gameState) return;
    
    const currentPlayer = roomData.players[currentUser.id];
    if (!currentPlayer) return;
    
    const gameState = roomData.gameState;
    const isMyTurn = currentPlayer.team === gameState.currentTurn;
    const isSpymaster = currentPlayer.role && currentPlayer.role.includes('spy');
    const isAgent = currentPlayer.role && !currentPlayer.role.includes('spy');
    
    // Update turn indicator
    updateTurnDisplay();
    
    // Show/hide sections based on role and turn
    const spymasterSection = document.getElementById('spymaster-section');
    const agentsSection = document.getElementById('agents-section');
    
    if (isSpymaster && isMyTurn && gameState.phase === 'waiting_clue') {
        spymasterSection.style.display = 'block';
        agentsSection.style.display = 'none';
        // Focus su input
        setTimeout(() => {
            document.getElementById('clue-word').focus();
        }, 100);
    } else if (isAgent && isMyTurn && gameState.phase === 'guessing') {
        spymasterSection.style.display = 'none';
        agentsSection.style.display = 'block';
        updateClueDisplay();
    } else {
        spymasterSection.style.display = 'none';
        agentsSection.style.display = 'none';
    }
    
    // Update word grid selectability
    updateWordSelectability();
}

function updateTurnDisplay() {
    if (!roomData || !roomData.gameState) return;
    
    const gameState = roomData.gameState;
    const turnTeam = gameState.currentTurn === 'red' ? 'ROSSO' : 'BLU';
    const turnDisplay = document.getElementById('current-turn-display');
    const teamSpan = document.getElementById('turn-team');
    const attemptsSpan = document.getElementById('attempts-count');
    
    teamSpan.textContent = turnTeam;
    turnDisplay.className = `turn-display ${gameState.currentTurn}`;
    
    if (gameState.attemptsRemaining !== undefined) {
        attemptsSpan.textContent = gameState.attemptsRemaining;
    } else {
        attemptsSpan.textContent = '0';
    }
}

function updateClueDisplay() {
    if (!roomData || !roomData.gameState) return;
    
    const clueDisplay = document.getElementById('clue-display');
    const currentClue = roomData.gameState.currentClue;
    
    if (currentClue) {
        clueDisplay.textContent = `"${currentClue.word}" - ${currentClue.number}`;
        clueDisplay.classList.add('active');
    } else {
        clueDisplay.textContent = 'In attesa dell\'indizio...';
        clueDisplay.classList.remove('active');
    }
}

function updateWordSelectability() {
    if (!roomData || !roomData.gameState) return;
    
    const currentPlayer = roomData.players[currentUser.id];
    if (!currentPlayer) return;
    
    const gameState = roomData.gameState;
    const canSelect = currentPlayer.team === gameState.currentTurn && 
                     !currentPlayer.role.includes('spy') && 
                     gameState.phase === 'guessing' &&
                     gameState.attemptsRemaining > 0;
    
    document.querySelectorAll('.word-card').forEach(card => {
        card.classList.remove('selectable', 'not-selectable');
        
        if (!card.classList.contains('revealed')) {
            if (canSelect) {
                card.classList.add('selectable');
            } else {
                card.classList.add('not-selectable');
            }
        }
    });
}

function updateScores() {
    if (!roomData || !roomData.gameState) return;
    
    document.getElementById('red-score').textContent = roomData.gameState.redScore;
    document.getElementById('blue-score').textContent = roomData.gameState.blueScore;
}

function updateTeams() {
    const redPlayers = document.getElementById('red-players');
    const bluePlayers = document.getElementById('blue-players');
    
    redPlayers.innerHTML = '';
    bluePlayers.innerHTML = '';

    if (!roomData) return;

    Object.values(roomData.players).forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player';
        if (player.role && player.role.includes('spy')) {
            playerDiv.classList.add('spy');
        }

        const roleText = player.role && player.role.includes('spy') ? ' (SPY)' : '';
        playerDiv.textContent = `${player.username}${roleText}`;

        if (player.team === 'red') {
            redPlayers.appendChild(playerDiv);
        } else if (player.team === 'blue') {
            bluePlayers.appendChild(playerDiv);
        }
    });
}

// CLUES HISTORY MANAGEMENT
function updateCluesHistory() {
    if (!roomData || !roomData.gameState || !roomData.gameState.gameHistory) return;

    const redCluesList = document.getElementById('red-clues-list');
    const blueCluesList = document.getElementById('blue-clues-list');
    
    redCluesList.innerHTML = '';
    blueCluesList.innerHTML = '';

    // Filtra solo i suggerimenti dalla storia
    const clues = roomData.gameState.gameHistory.filter(item => item.type === 'clue');
    
    clues.forEach(clueItem => {
        const clueDiv = document.createElement('div');
        clueDiv.className = `clue-item ${clueItem.team}`;
        
        clueDiv.innerHTML = `
            <div class="clue-word">"${clueItem.clue.word}" - <span class="clue-number">${clueItem.clue.number}</span></div>
            <div class="clue-author">da ${clueItem.player}</div>
        `;
        
        if (clueItem.team === 'red') {
            redCluesList.appendChild(clueDiv);
        } else {
            blueCluesList.appendChild(clueDiv);
        }
    });
    
    // Se non ci sono suggerimenti, mostra placeholder
    if (redCluesList.children.length === 0) {
        redCluesList.innerHTML = '<div style="opacity: 0.5; font-style: italic; text-align: center;">Nessun suggerimento</div>';
    }
    
    if (blueCluesList.children.length === 0) {
        blueCluesList.innerHTML = '<div style="opacity: 0.5; font-style: italic; text-align: center;">Nessun suggerimento</div>';
    }
}

// GAME OVER MANAGEMENT
function showGameOverModal(winner, reason) {
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const message = document.getElementById('game-over-message');
    const newGameBtn = document.getElementById('new-game-btn');
    
    let titleText = '';
    let messageText = '';
    
    if (reason === 'assassin') {
        titleText = 'ASSASSINO!';
        const loserTeam = winner === 'red' ? 'BLU' : 'ROSSA';
        messageText = `La squadra ${loserTeam} ha scelto l'assassino!\n\nVINCE LA SQUADRA ${winner.toUpperCase()}!`;
    } else {
        titleText = 'VITTORIA!';
        messageText = `VINCE LA SQUADRA ${winner.toUpperCase()}!`;
    }
    
    title.textContent = titleText;
    title.className = winner === 'red' ? 'red' : 'blue';
    message.textContent = messageText;
    
    // Mostra bottone "GIOCA ANCORA" solo al creatore
    if (isCreator) {
        newGameBtn.style.display = 'block';
    } else {
        newGameBtn.style.display = 'none';
    }
    
    modal.classList.add('active');
}

function closeGameOverModal() {
    document.getElementById('game-over-modal').classList.remove('active');
}

function startNewGame() {
    closeGameOverModal();
    
    sendMessage({
        type: 'refresh_game'
    });
}

// Handler messages
function handleClueGiven(data) {
    roomData = data.room;
    updateGameDisplay();
    
    if (data.clue) {
        showNotification(`Indizio: "${data.clue.word}" - ${data.clue.number}`, 'success');
    }
}

function handleWordSelected(data) {
    roomData = data.room;
    updateGameDisplay();
}

function handleTurnChanged(data) {
    roomData = data.room;
    updateGameDisplay();
    
    const newTeam = data.room.gameState.currentTurn === 'red' ? 'ROSSA' : 'BLU';
    showNotification(`Turno cambiato! Ora tocca alla squadra ${newTeam}`, 'info');
}

function handleTurnPassed(data) {
    roomData = data.room;
    updateGameDisplay();
    
    const newTeam = data.room.gameState.currentTurn === 'red' ? 'ROSSA' : 'BLU';
    showNotification(`Turno passato alla squadra ${newTeam}`, 'success');
}

function handleGameEnded(data) {
    roomData = data.room;
    updateGameDisplay();
    
    // Determina il motivo della fine partita
    const reason = data.reason || 'victory'; // 'assassin' o 'victory'
    
    // Mostra modal invece del banner
    setTimeout(() => {
        showGameOverModal(data.winner, reason);
    }, 1000);
}

function handleGameRefreshed(data) {
    roomData = data.room;
    updateGameDisplay();
    closeGameOverModal(); // Chiudi modal se era aperto
    showNotification('Nuova partita iniziata!', 'success');
}

// GAME MENU
function toggleGameMenu() {
    const menu = document.getElementById('game-menu');
    menu.classList.toggle('active');
}

function changeRole(role) {
    toggleGameMenu();
    
    let message = '';
    switch(role) {
        case 'red-spy':
            message = 'Sei sicuro di voler diventare SPYMASTER ROSSO?';
            break;
        case 'red-agent':
            message = 'Sei sicuro di voler diventare AGENTE ROSSO?';
            break;
        case 'blue-spy':
            message = 'Sei sicuro di voler diventare SPYMASTER BLU?';
            break;
        case 'blue-agent':
            message = 'Sei sicuro di voler diventare AGENTE BLU?';
            break;
    }
    
    currentAction = () => {
        sendMessage({
            type: 'change_role',
            role: role
        });
    };
    
    showConfirmModal(message);
}

function refreshGame() {
    if (!isCreator) return;
    
    currentAction = () => {
        sendMessage({
            type: 'refresh_game'
        });
    };
    
    showConfirmModal('Sei sicuro di voler generare una nuova partita?');
}

function leaveGame() {
    toggleGameMenu();
    
    currentAction = () => {
        sendMessage({
            type: 'leave_room'
        });
    };
    
    showConfirmModal('Sei sicuro di voler tornare alla HOME?');
}

function leaveRoom() {
    currentAction = () => {
        sendMessage({
            type: 'leave_room'
        });
    };
    
    showConfirmModal('Sei sicuro di voler uscire dalla stanza?');
}

function handleRoomLeft() {
    currentRoom = null;
    roomData = null;
    isCreator = false;
    document.getElementById('room-code').value = '';
    showHomePage();
}

// UI UTILITIES
function showLoading(text = 'Caricamento...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').classList.add('active');
}

function hideLoading() {
    document.getElementById('loading').classList.remove('active');
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notification-text');
    
    notification.className = `notification active ${type}`;
    notificationText.textContent = message;
    
    setTimeout(() => {
        notification.classList.remove('active');
    }, 3000);
}

function showConfirmModal(message) {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('confirm-modal').classList.remove('active');
    currentAction = null;
}

function confirmAction() {
    if (currentAction) {
        currentAction();
        currentAction = null;
    }
    closeModal();
}

// EVENT LISTENERS
document.addEventListener('click', function(e) {
    const menu = document.getElementById('game-menu');
    const menuBtn = document.querySelector('.menu-btn');
    
    if (menu && !menu.contains(e.target) && e.target !== menuBtn) {
        menu.classList.remove('active');
    }
});

// CLEANUP
window.addEventListener('beforeunload', function() {
    if (currentRoom) {
        sendMessage({
            type: 'leave_room'
        });
    }
    
    if (ws) {
        ws.close();
    }
});
