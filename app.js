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

// Cross-Engine Evaluation Tracking
let pendingHumanLogType = null;
let liveScores = {
    NN: { depth: '--', score: '0.00', bestMove: '-' },
    HEURISTIC: { depth: '--', score: '0.00', bestMove: '-' }
};

// Unique tracker incremented each move or game-reset to drop outdated thread replies
let positionToken = 0;

// Dual Web Worker Configuration for simultaneous NN and Heuristic processes
const nnWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const heurWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

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

function getOppositeAI() {
    if (gameMode.includes('nn')) return 'HEURISTIC';
    if (gameMode.includes('heur')) return 'NN';
    return null;
}

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
    
    // Prompt user to choose between Heuristic Bootstrap and NN Self-Play
    const useNN = confirm(
        "Select Training Data Harvesting Mode:\n\n" +
        "• OK: Neural Network Self-Play (Expert Iteration using 'checkers_valuenet.onnx')\n" +
        "• Cancel: Static Heuristic (Initial Bootstrapping)"
    );
    
    btn.innerText = `Harvesting (${useNN ? 'NN Self-Play' : 'Heuristic'})... Please Wait...`;
    
    const harvester = new DataHarvester(useNN, './checkers_valuenet.onnx');
    await harvester.runSimulation(10000, (current, total, positions) => {
        btn.innerText = `Harvesting Game ${current}/${total} (${positions} pos)...`;
    });
    
    btn.innerText = "🌾 Harvest 10000 Training Games";
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
    pendingHumanLogType = null;
    
    liveScores = {
        NN: { depth: '--', score: '0.00', bestMove: '-' },
        HEURISTIC: { depth: '--', score: '0.00', bestMove: '-' }
    };
    
    // Invalidate any calculations active from the preceding setup
    positionToken++;
    
    nnWorker.postMessage({ cmd: 'clear' });
    heurWorker.postMessage({ cmd: 'clear' });
    
    const selectEl = document.getElementById('mode-select');
    const modeText = selectEl.options[selectEl.selectedIndex].text;
    document.getElementById('log').innerHTML = `<div>--- NEW GAME STARTED (${modeText}) ---</div>`;
    
    document.getElementById('depth-val').innerText = "NN: -- | HEUR: --";
    document.getElementById('score-val').innerText = "NN: 0.00 | HEUR: 0.00";
    
    let bestMoveEl = document.getElementById('best-move-val');
    if (bestMoveEl) bestMoveEl.innerText = "NN: - | HEUR: -";
    
    document.getElementById('nn-eval-fill').style.height = "50%";
    document.getElementById('heur-eval-fill').style.height = "50%";
    
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
            
            if (selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c) {
                sq.classList.add('selected');
            }
            
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
    
    // Fixed structural check during active double jump selection
    if (activePiece) {
        selectedSquare = activePiece;
        let chosenMove = moves.find(m => 
            m.from[0] === selectedSquare[0] && m.from[1] === selectedSquare[1] &&
            m.to[0] === r && m.to[1] === c
        );
        if (chosenMove) {
            executeMove(chosenMove, 0, 0, "HUMAN");
        }
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

function handleWorkerMessage(msg, isNNWorker) {
    // Drop any messages matching discarded position history or previous configurations
    if (msg.positionToken !== undefined && msg.positionToken !== positionToken) {
        return;
    }
    
    if (msg.type === 'status') {
        document.getElementById('log').innerHTML += `<div>[Worker]: ${msg.text}</div>`;
        if (msg.text.includes("Loaded")) {
            setTimeout(gameLoop, 500);
        }
    } else if (msg.type === 'info') {
        let scoreDisplay = (msg.bestVal > 80000) ? "+M" : (msg.bestVal < -80000 ? "-M" : (msg.bestVal / 100).toFixed(2));
        let moveNotation = msg.bestMove ? toStandardNotation(msg.bestMove) : '-';
        
        // Dynamically assign evaluation fields to the last human move line if requested
        if (pendingHumanLogType === 'NN' && isNNWorker) {
            let hScore = document.getElementById('human-score-val');
            let hDepth = document.getElementById('human-depth-val');
            if (hScore) hScore.innerText = scoreDisplay;
            if (hDepth) hDepth.innerText = msg.depth;
        } else if (pendingHumanLogType === 'HEURISTIC' && !isNNWorker) {
            let hScore = document.getElementById('human-score-val');
            let hDepth = document.getElementById('human-depth-val');
            if (hScore) hScore.innerText = scoreDisplay;
            if (hDepth) hDepth.innerText = msg.depth;
        }

        if (isNNWorker) {
            document.getElementById('nn-eval-fill').style.height = getBarPercent(msg.bestVal) + "%";
            liveScores.NN.depth = msg.depth;
            liveScores.NN.score = scoreDisplay;
            liveScores.NN.bestMove = moveNotation;
        } else {
            document.getElementById('heur-eval-fill').style.height = getBarPercent(msg.bestVal) + "%";
            liveScores.HEURISTIC.depth = msg.depth;
            liveScores.HEURISTIC.score = scoreDisplay;
            liveScores.HEURISTIC.bestMove = moveNotation;
        }

        // Live dual updates to stats dashboard elements
        document.getElementById('depth-val').innerText = `NN: ${liveScores.NN.depth} | HEUR: ${liveScores.HEURISTIC.depth}`;
        document.getElementById('score-val').innerText = `NN: ${liveScores.NN.score} | HEUR: ${liveScores.HEURISTIC.score}`;

        // Lazy insertion layout check for Best Move row under the live score
        let bestMoveEl = document.getElementById('best-move-val');
        if (!bestMoveEl) {
            let statsDiv = document.querySelector('.stats');
            if (statsDiv) {
                let statLine = document.createElement('div');
                statLine.className = 'stat-line';
                statLine.innerHTML = `<span>Best Move:</span> <span id="best-move-val">--</span>`;
                statsDiv.appendChild(statLine);
                bestMoveEl = document.getElementById('best-move-val');
            }
        }
        if (bestMoveEl) {
            bestMoveEl.innerText = `NN: ${liveScores.NN.bestMove} | HEUR: ${liveScores.HEURISTIC.bestMove}`;
        }

    } else if (msg.type === 'bestmove') {
        let currentEngine = getPlayerEngine(turn);
        // Exclude automatic execution loops when evaluating on a human input turn
        if (currentEngine !== 'HUMAN') {
            if ((isNNWorker && currentEngine === 'NN') || (!isNNWorker && currentEngine === 'HEURISTIC')) {
                isThinking = false;
                let bestMove = msg.bestMove;
                let bestVal = msg.bestVal;
                let depth = msg.depth;

                if (!bestMove) {
                    document.getElementById('status').innerText = (turn === 1 ? "BLUE WINS!" : "RED WINS!");
                    return;
                }

                executeMove(bestMove, bestVal, depth, currentEngine);
            }
        }
    }
}

nnWorker.onmessage = (e) => handleWorkerMessage(e.data, true);
heurWorker.onmessage = (e) => handleWorkerMessage(e.data, false);

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

    if (currentEngine === 'HUMAN') {
        isThinking = false;
        if (activePiece) selectedSquare = activePiece;
        render();
        document.getElementById('status').innerText = `YOUR TURN (${turn === 1 ? 'RED' : 'BLUE'}) - CLICK PIECE TO MOVE`;
        
        // Background thread evaluation capped at a 10 second timeout max
        nnWorker.postMessage({
            cmd: 'search',
            board: board,
            turn: turn,
            gameHistory: gameHistory,
            thinkTime: 10000,
            activePiece: activePiece,
            useNN: true,
            positionToken: positionToken
        });
        
        heurWorker.postMessage({
            cmd: 'search',
            board: board,
            turn: turn,
            gameHistory: gameHistory,
            thinkTime: 10000,
            activePiece: activePiece,
            useNN: false,
            positionToken: positionToken
        });
        return;
    }

    isThinking = true;
    let aiTypeLabel = currentEngine === 'NN' ? "NEURAL NET" : "HEURISTIC";
    document.getElementById('status').innerText = `${turn === 1 ? 'RED' : 'BLUE'} AI (${aiTypeLabel}) THINKING...`;

    let thinkTime = Math.floor(Math.random() * 1001) + 5000; 

    // Synchronized step updates across both analysis panels
    nnWorker.postMessage({
        cmd: 'search',
        board: board,
        turn: turn,
        gameHistory: gameHistory,
        thinkTime: thinkTime,
        activePiece: activePiece,
        useNN: true,
        positionToken: positionToken
    });

    heurWorker.postMessage({
        cmd: 'search',
        board: board,
        turn: turn,
        gameHistory: gameHistory,
        thinkTime: thinkTime,
        activePiece: activePiece,
        useNN: false,
        positionToken: positionToken
    });
}

function executeMove(bestMove, bestVal, depth, moverType) {
    if (!bestMove || !bestMove.from || !bestMove.to) return;
    
    let currentHash = getHash(board, turn);
    let movingPiece = board[bestMove.from[0]][bestMove.from[1]];
    let isPromotion = (movingPiece === 1 && bestMove.to[0] === 0) || (movingPiece === 2 && bestMove.to[0] === 7);
    
    if (bestMove.capture || isPromotion) {
        halfMoveClock = 0;
        nnWorker.postMessage({ cmd: 'clear' }); 
        heurWorker.postMessage({ cmd: 'clear' }); 
    } else {
        halfMoveClock++;
    }

    board = makeMove(board, bestMove);
    gameHistory.push(currentHash);
    moveCount++;
    
    // Invalidate background search pipelines running on the previous state
    positionToken++;
    render();

    let notation = toStandardNotation(bestMove);
    
    // Strip IDs from older human game elements so they don't collision rewrite later
    let oldScoreSpan = document.getElementById('human-score-val');
    let oldDepthSpan = document.getElementById('human-depth-val');
    if (oldScoreSpan) oldScoreSpan.removeAttribute('id');
    if (oldDepthSpan) oldDepthSpan.removeAttribute('id');

    let logBox = document.getElementById('log');
    let moveEntry = document.createElement('div');
    
    if (moverType === "HUMAN") {
        let oppAI = getOppositeAI();
        if (oppAI) {
            moveEntry.innerHTML = `#${moveCount} ${turn === 1 ? 'BLU' : 'RED'} (${moverType}): ${notation} (Depth: <span id="human-depth-val">-</span>, Eval: <span id="human-score-val">calculating...</span>)`;
            pendingHumanLogType = oppAI;
        } else {
            moveEntry.innerText = `#${moveCount} ${turn === 1 ? 'BLU' : 'RED'} (${moverType}): ${notation} (Depth: -, Eval: N/A)`;
            pendingHumanLogType = null;
        }
    } else {
        let scoreDisplay = (bestVal > 80000) ? "+M" : (bestVal < -80000 ? "-M" : (bestVal / 100).toFixed(2));
        moveEntry.innerText = `#${moveCount} ${turn === 1 ? 'BLU' : 'RED'} (${moverType}): ${notation} (Depth: ${depth}, Eval: ${scoreDisplay})`;
    }
    
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
nnWorker.postMessage({ cmd: 'init_nn', modelUrl: './checkers_valuenet.onnx' });