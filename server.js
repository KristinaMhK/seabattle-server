const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Seabattle WS Server is running');
});

const wss = new WebSocketServer({ server });

const GRID_SIZE = 7;
let waitingPlayer = null;
let games = {};
let playerGameMap = new Map();

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

wss.on('connection', (ws) => {
    ws.playerId = generateId();
    console.log(`Player connected: ${ws.playerId}`);

    ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        switch (data.type) {
            case 'find_game':
                if (waitingPlayer && waitingPlayer.readyState === 1) {
                    const gameId = generateId();
                    const game = {
                        id: gameId,
                        players: {1: waitingPlayer, 2: ws},
                        boards: {},
                        ships: {},
                        ready: {1: false, 2: false},
                        turn: 1,
                    };
                    games[gameId] = game;
                    playerGameMap.set(waitingPlayer.playerId, {gameId, num: 1});
                    playerGameMap.set(ws.playerId, {gameId, num: 2});

                    waitingPlayer.send(JSON.stringify({type: 'game_start', gameId, player: 1}));
                    ws.send(JSON.stringify({type: 'game_start', gameId, player: 2}));
                    waitingPlayer = null;
                } else {
                    waitingPlayer = ws;
                    ws.send(JSON.stringify({type: 'waiting'}));
                }
                break;

            case 'ready':
                const pInfo = playerGameMap.get(ws.playerId);
                if (!pInfo) return;
                const game2 = games[pInfo.gameId];
                if (!game2) return;

                game2.boards[pInfo.num] = data.board;
                game2.ships[pInfo.num] = extractShips(data.board);
                game2.ready[pInfo.num] = true;

                if (game2.ready[1] && game2.ready[2]) {
                    const first = Math.random() > 0.5 ? 1 : 2;
                    game2.turn = first;
                    game2.players[1].send(JSON.stringify({type: 'both_ready', first}));
                    game2.players[2].send(JSON.stringify({type: 'both_ready', first}));
                }
                break;

            case 'shoot':
                const sInfo = playerGameMap.get(ws.playerId);
                if (!sInfo) return;
                const game3 = games[sInfo.gameId];
                if (!game3 || game3.turn !== sInfo.num) return;

                const opponent = sInfo.num === 1 ? 2 : 1;
                const board = game3.boards[opponent];
                const row = data.row, col = data.col;

                let result, sunkCells = [];
                if (board[row][col] === 1) {
                    board[row][col] = 2;
                    const ship = findShip(game3.ships[opponent], row, col);
                    if (ship && ship.every(c => board[c.row][c.col] === 2)) {
                        result = 'kill';
                        sunkCells = ship;
                        for (const c of ship) board[c.row][c.col] = 4;
                    } else {
                        result = 'hit';
                    }
                } else {
                    board[row][col] = 3;
                    result = 'miss';
                }

                const allSunk = game3.ships[opponent].every(
                    ship => ship.every(c => board[c.row][c.col] === 4)
                );

                const nextTurn = (result === 'miss') ? opponent : sInfo.num;
                game3.turn = nextTurn;

                const shotData = {
                    type: 'shot_result',
                    shooter: sInfo.num,
                    row, col, result,
                    sunkCells,
                    nextTurn,
                };

                game3.players[1].send(JSON.stringify(shotData));
                game3.players[2].send(JSON.stringify(shotData));

                if (allSunk) {
                    game3.players[1].send(JSON.stringify({type: 'game_over', winner: sInfo.num}));
                    game3.players[2].send(JSON.stringify({type: 'game_over', winner: sInfo.num}));
                    delete games[sInfo.gameId];
                }
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected: ${ws.playerId}`);
        if (waitingPlayer === ws) waitingPlayer = null;

        const info = playerGameMap.get(ws.playerId);
        if (info) {
            const game = games[info.gameId];
            if (game) {
                const other = info.num === 1 ? 2 : 1;
                if (game.players[other] && game.players[other].readyState === 1) {
                    game.players[other].send(JSON.stringify({type: 'opponent_disconnected'}));
                }
                delete games[info.gameId];
            }
            playerGameMap.delete(ws.playerId);
        }
    });
});

function extractShips(board) {
    const visited = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(false));
    const ships = [];

    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (board[r][c] === 1 && !visited[r][c]) {
                const ship = [];
                const queue = [{row: r, col: c}];
                visited[r][c] = true;

                while (queue.length > 0) {
                    const cur = queue.shift();
                    ship.push(cur);
                    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                        const nr = cur.row + dr, nc = cur.col + dc;
                        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE
                            && board[nr][nc] === 1 && !visited[nr][nc]) {
                            visited[nr][nc] = true;
                            queue.push({row: nr, col: nc});
                        }
                    }
                }
                ships.push(ship);
            }
        }
    }
    return ships;
}

function findShip(ships, row, col) {
    return ships.find(ship => ship.some(c => c.row === row && c.col === col));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
});
