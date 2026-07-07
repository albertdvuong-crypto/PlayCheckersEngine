export function toStandardNotation(move) {
    // Standard Checkers Notation numbers squares from 1 to 32.
    function getSquare(r, c) {
        return (r * 4) + Math.floor(c / 2) + 1;
    }
    
    let start = getSquare(move.from[0], move.from[1]);
    let end = getSquare(move.to[0], move.to[1]);
    let separator = move.capture ? 'x' : '-';
    
    return `${start}${separator}${end}`;
}