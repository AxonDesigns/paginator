export type RowChildSizing = {
    kind: 'fixed';
    size: number;
} | {
    kind: 'flex';
    weight: number;
};
/** `availableWidth` should already have any gap total subtracted by the caller. */
export declare function resolveFlexWidths(sizing: RowChildSizing[], availableWidth: number): number[];
