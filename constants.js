export const zobristTable = Array.from({ length: 8 }, () => 
    Array.from({ length: 8 }, () => 
        Array.from({ length: 5 }, () => Math.floor(Math.random() * 0xFFFFFFFF))
    )
);

export const zobristTurn = Math.floor(Math.random() * 0xFFFFFFFF);

export const INITIAL_BOARD = [
    [0, 2, 0, 2, 0, 2, 0, 2],
    [2, 0, 2, 0, 2, 0, 2, 0],
    [0, 2, 0, 2, 0, 2, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 1, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 0]
];