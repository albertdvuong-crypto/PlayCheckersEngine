import { getMoves, makeMove, alphaBeta, setTimeLimit, abortSearch, clearCache, loadONNXModel, setEvalMode } from './engine.js';

self.onmessage = async function(e) {
    const msg = e.data;
    
    if (msg.cmd === 'init_nn') {
        try {
            self.postMessage({ type: 'status', text: 'Loading ONNX Neural Network...' });
            await loadONNXModel(msg.modelUrl);
            self.postMessage({ type: 'status', text: 'ONNX Neural Network Loaded Successfully!' });
        } catch (err) {
            console.error("Failed to load ONNX model in worker:", err);
            self.postMessage({ type: 'status', text: 'ONNX load failed. Using Heuristic fallback.' });
        }
        return;
    }

    if (msg.cmd === 'clear') {
        clearCache();
        return;
    }
    
    if (msg.cmd === 'search') {
        const { board, turn, gameHistory, thinkTime, activePiece, useNN, positionToken } = msg;
        
        setEvalMode(useNN !== undefined ? useNN : true);
        setTimeLimit(thinkTime);
        
        let { moves } = getMoves(board, turn, activePiece);
        if (moves.length === 0) {
            self.postMessage({ type: 'bestmove', bestMove: null, bestVal: 0, depth: 0, positionToken: positionToken });
            return;
        }
        
        let globalBestMove = moves[0];
        let globalBestVal = (turn === 1) ? -Infinity : Infinity;
        let completedDepth = 0;
        
        let workingHistory = [...gameHistory];
        
        for (let depth = 1; depth <= 50; depth++) {
            let iterationBestMove = moves[0];
            let iterationBestVal = (turn === 1) ? -Infinity : Infinity;
            let iterationAborted = false;
            
            for (let m of moves) {
                let nextB = makeMove(board, m);
                
                let movingPiece = board[m.from[0]][m.from[1]];
                let isPromotion = (movingPiece === 1 && m.to[0] === 0) || (movingPiece === 2 && m.to[0] === 7);
                let continues = m.capture && !isPromotion && getMoves(nextB, turn, m.to).isJump;
                
                let val = continues
                    ? alphaBeta(nextB, depth, -Infinity, Infinity, turn === 1, turn, m.to, workingHistory)
                    : alphaBeta(nextB, depth - 1, -Infinity, Infinity, turn !== 1, turn === 1 ? 2 : 1, null, workingHistory);
                    
                if (abortSearch) {
                    iterationAborted = true;
                    break; 
                }
                
                if (isNaN(val) || !isFinite(val)) {
                    val = 0;
                }
                
                if (Math.abs(val) < 80000) {
                    val += Math.round(Math.random() * 2 - 1);
                }
                
                if ((turn === 1 && val > iterationBestVal) || (turn === 2 && val < iterationBestVal)) {
                    iterationBestVal = val;
                    iterationBestMove = m;
                }
            }
            
            if (iterationAborted && completedDepth > 0) break; 
            
            globalBestMove = iterationBestMove || moves[0];
            globalBestVal = iterationBestVal;
            completedDepth = depth;
            
            self.postMessage({
                type: 'info',
                depth: depth,
                bestVal: globalBestVal,
                bestMove: globalBestMove,
                positionToken: positionToken
            });
            
            // Instantly snap to the shortest mate path and stop searching deeper
            if (Math.abs(globalBestVal) > 80000) {
                break;
            }
            
            moves.sort((a, b) => {
                if (a === globalBestMove) return -1;
                if (b === globalBestMove) return 1;
                return 0;
            });
        }
        
        self.postMessage({
            type: 'bestmove',
            bestMove: globalBestMove || moves[0],
            bestVal: globalBestVal,
            depth: completedDepth,
            positionToken: positionToken
        });
    }
};
