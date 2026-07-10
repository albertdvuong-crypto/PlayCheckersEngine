import { INITIAL_BOARD } from './constants.js';
import { getMoves, makeMove, getHash, evaluateHeuristic, evaluateBoardWithNN, loadONNXModel } from './engine.js';

export class DataHarvester {
    constructor(useNN = false, modelUrl = './checkers_valuenet.onnx') {
        this.dataset = [];
        this.useNN = useNN;
        this.modelUrl = modelUrl;
        this.styles = ['linear', 'quadratic', 'exponential', 'sigmoid'];
    }

    // Extract the 32 playable dark squares from the 8x8 grid
    boardTo32Squares(board) {
        let squares = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 !== 0) {
                    squares.push(board[r][c]);
                }
            }
        }
        return squares; // Returns array of 32 integers: 0, 1, 2, 3, or 4
    }

    getRandomStyle() {
        return this.styles[Math.floor(Math.random() * this.styles.length)];
    }

    // Fast 1-ply policy with exploration to prevent deterministic loops
    getFastMove(board, turn, activePiece = null, playerStyle = 'linear') {
        let { moves } = getMoves(board, turn, activePiece);
        if (moves.length === 0) return null;

        // 20% Exploration: Pick a random valid move
        if (Math.random() < 0.20) {
            return moves[Math.floor(Math.random() * moves.length)];
        }

        // 95% Exploitation: Pick the immediate best move using Heuristic (with fixed game style) OR Neural Network
        let bestMove = null;
        let bestVal = (turn === 1) ? -Infinity : Infinity;

        for (let m of moves) {
            let nextB = makeMove(board, m);
            
            // Pass the player's specific style into evaluateHeuristic for consistent decision-making
            let val = this.useNN ? evaluateBoardWithNN(nextB) : evaluateHeuristic(nextB, playerStyle);
            
            // Add slight noise to break ties
            val += (Math.random() * 2 - 1);

            if ((turn === 1 && val > bestVal) || (turn === 2 && val < bestVal)) {
                bestVal = val;
                bestMove = m;
            }
        }
        return bestMove;
    }

    async runSimulation(numGames = 10000, onProgress = null) {
        if (this.useNN) {
            console.log(`Loading ONNX model from ${this.modelUrl} for NN Self-Play harvesting...`);
            try {
                await loadONNXModel(this.modelUrl);
                console.log("NN model successfully loaded into main thread for self-play harvesting!");
            } catch (err) {
                console.warn("Could not load ONNX model. Falling back to heuristic evaluation.", err);
                this.useNN = false;
            }
        }

        console.log(`Starting harvest of ${numGames} fast-play games using ${this.useNN ? 'NEURAL NET (Self-Play)' : 'HEURISTIC (Bootstrap with Style-Clashing)'}...`);
        this.dataset = [];

        for (let g = 0; g < numGames; g++) {
            let board = JSON.parse(JSON.stringify(INITIAL_BOARD));
            let turn = 1;
            let gameHistory = [];
            let stateTrajectory = [];
            let halfMoveClock = 0;
            let outcome = 0.0; // Default draw
            let activePiece = null;

            // Assign distinct styles to each player for this specific game
            let p1Style = this.getRandomStyle();
            let p2Style = this.getRandomStyle();

            while (true) {
                let currentHash = getHash(board, turn);
                
                // Check draw conditions (3-fold repetition or 50-move rule)
                if (gameHistory.filter(h => h === currentHash).length >= 3 || halfMoveClock >= 100) {
                    outcome = 0.0;
                    break;
                }

                let currentStyle = (turn === 1) ? p1Style : p2Style;
                let move = this.getFastMove(board, turn, activePiece, currentStyle);
                if (!move) {
                    if (activePiece) {
                        // If no further jump is possible in a multi-jump chain, end turn
                        activePiece = null;
                        turn = (turn === 1) ? 2 : 1;
                        continue;
                    }
                    // Current player has no moves available; opponent wins
                    outcome = (turn === 1) ? -1.0 : 1.0;
                    break;
                }

                // Record the current 32-square state before moving (only at start of turn, not mid-jump)
                if (!activePiece) {
                    stateTrajectory.push(this.boardTo32Squares(board));
                }

                let movingPiece = board[move.from[0]][move.from[1]];
                let isPromotion = (movingPiece === 1 && move.to[0] === 0) || (movingPiece === 2 && move.to[0] === 7);
                if (move.capture || isPromotion) {
                    halfMoveClock = 0;
                } else {
                    halfMoveClock++;
                }

                board = makeMove(board, move);
                gameHistory.push(currentHash);

                // Check if multi-jump continuation applies
                if (move.capture && !isPromotion && getMoves(board, turn, move.to).isJump) {
                    activePiece = move.to; // Same player continues jumping from landing square
                } else {
                    activePiece = null;
                    turn = (turn === 1) ? 2 : 1;
                }
            }

            // Assign final game outcome to every board state visited in this game
            for (let state of stateTrajectory) {
                this.dataset.push({
                    state: state,
                    outcome: outcome
                });
            }

            if (onProgress && (g + 1) % 50 === 0) {
                onProgress(g + 1, numGames, this.dataset.length);
                // Yield to main thread briefly to prevent UI freeze
                await new Promise(r => setTimeout(r, 0));
            }
        }

        console.log(`Harvest complete! Total training positions collected: ${this.dataset.length}`);
        this.downloadDataset();
    }

    downloadDataset() {
        const jsonString = JSON.stringify(this.dataset);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const prefix = this.useNN ? "nn_selfplay" : "heuristic_bootstrap";
        a.download = `checkers_dataset_${prefix}_${this.dataset.length}_positions.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}