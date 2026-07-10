export function toStandardNotation(move) {
    // Standard Checkers Notation numbers squares from 1 to 32.
    function getSquare(r, c) {
        // Invert the row coordinates so that row 7 starts at squares 1-4 
        // and row 0 ends at squares 29-32, resolving the orientation error.
        let invertedRow = 7 - r;
        let invertedCol = 7 - c; 
        return (invertedRow * 4) + Math.floor(invertedCol / 2) + 1;
    }
    
    let start = getSquare(move.from[0], move.from[1]);
    let end = getSquare(move.to[0], move.to[1]);
    let separator = move.capture ? 'x' : '-';
    
    return `${start}${separator}${end}`;
}