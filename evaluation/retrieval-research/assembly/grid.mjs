export const BUDGETS = Object.freeze([128, 192, 256, 384, 512, 768, 1024, 1536]);
export const expectedCellCount = grid => grid.arms.length * grid.rankings.length * grid.overheads.length * grid.budgets.length;
