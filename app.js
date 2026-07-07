import { INITIAL_BOARD } from './constants.js';
import { getMoves, makeMove, getHash } from './engine.js';
import { toStandardNotation } from './notation.js';
import { DataHarvester } from './harvester.js';

let board = JSON.parse(JSON.stringify(INITIAL_BOARD));
let turn = 1; 
let moveCount = 0;
let halfMoveClock = 0;
let gameHistory = [];
let activePiece = null; 

// Interactive Play States
let gameMode = 'human_vs_nn_blue';
let selectedSquare = null;
let isThinking = false;

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

// Determine which player controls the current turn ('HUMAN', 'HEURISTIC', or 'NN')
function getPlayerEngine(playerTurn) {
    switch (gameMode) {
        case 'human_vs_nn_blue':   return playerTurn === 1 ? 'HUMAN' : 'NN';
        case 'human_vs_nn_red':    return playerTurn === 1 ? 'NN' : 'HUMAN';
        case 'human_vs_heur_blue': return playerTurn === 1 ? 'HUMAN' : 'HEURISTIC';
        case 'human_vs_heur_red':  return playerTurn === 1 ? 'HEURISTIC' : 'HUMAN';
        case 'heur_vs_nn_blue':    return playerTurn === 1 ? 'HEURISTIC' : 'NN';
        case 'heur_vs_nn_red':     return playerTurn === 1 ? 'NN' : 'HEURISTIC';
        case 'nn_vs_nn':           return 'NN';
        case 'heur_vs_heur':       return 'HEURISTIC';
        default:                   return playerTurn === 1 ? 'HUMAN' : 'NN';
    }
}

// Wire Up UI Controls
document.getElementById('mode-select').onchange = (e) => {
    gameMode = e.target.value;
    startNewGame();
};

document.getElementById('btn-new-game').onclick = () => {
    startNewGame();
};

document.getElementById('btn-harvest').onclick = async () => {
    const btn = document.getElementById('btn-harvest');
    btn.disabled = true;
    btn.innerText = "Harvesting... Please Wait...";
    
    const harvester = new DataHarvester();
    await harvester.runSimulation(5000, (current, total, positions) => {
        btn.innerText = `Harvesting Game ${current}/${total} (${positions} positions)...`;
    });
    
    btn.innerText = "🌾 Harvest 5000 Training Games";
    btn.disabled = false;
};

function startNewGame() {
    board = JSON.parse(JSON.stringify(INITIAL_BOARD));
    turn = 1;
    moveCount = 0;
    halfMoveClock = 0;
    gameHistory = [];
    activePiece = null;
    selectedSquare = null;
    isThinking = false;
    
    worker.postMessage({ cmd: 'clear' });
    
    const selectEl = document.getElementById('mode-select');
    const modeText = selectEl.options[selectEl.selectedIndex].text;
    document.getElementById('log').innerHTML = `<div>--- NEW GAME STARTED (${modeText}) ---</div>`;
    document.getElementById('depth-val').innerText = "--";
    document.getElementById('score-val').innerText = "0.00";
    document.getElementById('eval-fill').style.height = "50%";
    
    render();
    setTimeout(gameLoop, 200);
}

function getBarPercent(bestVal) {
    if (bestVal > 80000) return 100; 
    if (bestVal < -80000) return 0;  
    let pawns = bestVal / 100.0;
    let pct = 50 + 50 * (2 / (1 + Math.exp(-0.4 * pawns)) - 1);
    return Math.max(0, Math.min(100, pct));
}

function render() {
    const container = document.getElementById('board');
    if (!container) return;
    container.innerHTML = '';
    
    let { moves } = getMoves(board, turn, activePiece);
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const sq = document.createElement('div');
            sq.className = `sq ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
            
            // Highlight selected piece
            if (selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c) {
                sq.classList.add('selected');
            }
            
            // Highlight valid target squares for human player (works on Red or Blue)
            if (selectedSquare && getPlayerEngine(turn) === 'HUMAN') {
                let isValidTarget = moves.some(m => 
                    m.from[0] === selectedSquare[0] && m.from[1] === selectedSquare[1] &&
                    m.to[0] === r && m.to[1] === c
                );
                if (isValidTarget) {
                    sq.classList.add('valid-target');
                }
            }
            
            const p = board[r][c];
            if (p > 0) {
                const piece = document.createElement('div');
                piece.className = `piece ${p % 2 !== 0 ? 'red' : 'blue'} ${p > 2 ? 'king' : ''}`;
                sq.appendChild(piece);
            }
            
            sq.onclick = () => onSquareClick(r, c);
            container.appendChild(sq);
        }
    }
}

function onSquareClick(r, c) {
    if (isThinking || getPlayerEngine(turn) !== 'HUMAN') return;
    
    let { moves } = getMoves(board, turn, activePiece);
    
    // If during a multi-jump chain, force human selection to the jumping piece
    if (activePiece && (r !== activePiece[0] || c !== activePiece[1])) {
        if (!selectedSquare) selectedSquare = activePiece;
        render();
        return;
    }

    if (selectedSquare) {
        let chosenMove = moves.find(m => 
            m.from[0] === selectedSquare[0] && m.from[1] === selectedSquare[1] &&
            m.to[0] === r && m.to[1] === c
        );
        
        if (chosenMove) {
            selectedSquare = null;
            executeMove(chosenMove, 0, 0, "HUMAN");
            return;
        }
        
        // Check if clicking another own piece to switch selection
        let isOwnPiece = (turn === 1) ? (board[r][c] === 1 || board[r][c] === 3) : (board[r][c] === 2 || board[r][c] === 4);
        if (isOwnPiece) {
            let pieceHasMoves = moves.some(m => m.from[0] === r && m.from[1] === c);
            if (pieceHasMoves) {
                selectedSquare = [r, c];
                render();
                return;
            }
        }
        
        selectedSquare = null;
        render();
    } else {
        let isOwnPiece = (turn === 1) ? (board[r][c] === 1 || board[r][c] === 3) : (board[r][c] === 2 || board[r][c] === 4);
        if (isOwnPiece) {
            let pieceHasMoves = moves.some(m => m.from[0] === r && m.from[1] === c);
            if (pieceHasMoves) {
                selectedSquare = [r, c];
                render();
            }
        }
    }
}

worker.onmessage = function(e) {
    const msg = e.data;
    
    if (msg.type === 'status') {
        document.getElementById('log').innerHTML += `<div>[Worker]: ${msg.text}</div>`;
        if (msg.text.includes("Loaded")) {
            setTimeout(gameLoop, 500);
        }
    } else if (msg.type === 'info') {
        document.getElementById('depth-val').innerText = msg.depth;
        let scoreDisplay = (msg.bestVal > 80000) ? "+M" : (msg.bestVal < -80000 ? "-M" : (msg.bestVal / 100).toFixed(2));
        document.getElementById('score-val').innerText = scoreDisplay;
        document.getElementById('eval-fill').style.height = getBarPercent(msg.bestVal) + "%";
        
    } else if (msg.type === 'bestmove') {
        isThinking = false;
        let bestMove = msg.bestMove;
        let bestVal = msg.bestVal;
        let depth = msg.depth;

        if (!bestMove) {
            document.getElementById('status').innerText = (turn === 1 ? "BLUE WINS!" : "RED WINS!");
            return;
        }

        executeMove(bestMove, bestVal, depth, "AI");
    }
};

async function gameLoop() {
    let { moves } = getMoves(board, turn, activePiece);
    if (moves.length === 0) {
        document.getElementById('status').innerText = (turn === 1 ? "BLUE WINS!" : "RED WINS!");
        return;
    }

    let currentHash = getHash(board, turn);
    if (gameHistory.filter(h => h === currentHash).length >= 3) {
        document.getElementById('status').innerText = "DRAW (3-Fold Repetition)";
        return;
    }
    if (halfMoveClock >= 100) { 
        document.getElementById('status').innerText = "DRAW (50-Move Rule)";
        return;
    }

    let currentEngine = getPlayerEngine(turn);

    // Handle Human Turn (Red or Blue)
    if (currentEngine === 'HUMAN') {
        isThinking = false;
        if (activePiece) selectedSquare = activePiece;
        render();
        document.getElementById('status').innerText = `YOUR TURN (${turn === 1 ? 'RED' : 'BLUE'}) - CLICK PIECE TO MOVE`;
        return;
    }

    isThinking = true;
    let useNN = (currentEngine === 'NN');
    let aiTypeLabel = useNN ? "NEURAL NET" : "HEURISTIC";
    document.getElementById('status').innerText = `${turn === 1 ? 'RED' : 'BLUE'} AI (${aiTypeLabel}) THINKING...`;

    let thinkTime = 2000; 

    worker.postMessage({
        cmd: 'search',
        board: board,
        turn: turn,
        gameHistory: gameHistory,
        thinkTime: thinkTime,
        activePiece: activePiece,
        useNN: useNN
    });
}

function executeMove(bestMove, bestVal, depth, moverType) {
    if (!bestMove || !bestMove.from || !bestMove.to) return;
    
    let currentHash = getHash(board, turn);
    let movingPiece = board[bestMove.from[0]][bestMove.from[1]];
    let isPromotion = (movingPiece === 1 && bestMove.to[0] === 0) || (movingPiece === 2 && bestMove.to[0] === 7);
    
    if (bestMove.capture || isPromotion) {
        halfMoveClock = 0;
        worker.postMessage({ cmd: 'clear' }); 
    } else {
        halfMoveClock++;
    }

    board = makeMove(board, bestMove);
    gameHistory.push(currentHash);
    moveCount++;
    render();

    let notation = toStandardNotation(bestMove);
    let scoreDisplay = moverType === "HUMAN" ? "N/A" : ((bestVal > 80000) ? "+M" : (bestVal < -80000 ? "-M" : (bestVal / 100).toFixed(2)));
    let depthDisplay = moverType === "HUMAN" ? "-" : depth;
    
    let logBox = document.getElementById('log');
    let moveEntry = document.createElement('div');
    moveEntry.innerText = `#${moveCount} ${turn === 1 ? 'RED' : 'BLU'} (${moverType}): ${notation} (Depth: ${depthDisplay}, Eval: ${scoreDisplay})`;
    logBox.appendChild(moveEntry);
    logBox.scrollTop = logBox.scrollHeight;

    if (bestMove.capture && !isPromotion && getMoves(board, turn, bestMove.to).isJump) {
        activePiece = bestMove.to; 
        setTimeout(gameLoop, 200);
    } else {
        activePiece = null; 
        turn = (turn === 1) ? 2 : 1;
        setTimeout(gameLoop, 100);
    }
}

render();
worker.postMessage({ cmd: 'init_nn', modelUrl: './checkers_valuenet.onnx' });