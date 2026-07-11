import type { ContainerBorder, LineStyle, TableBorderLineMode, TableNode } from '../../core/nodes.js';
import type { RenderedTableRow } from '../../core/geometry.js';
export type LineStyleResolved = {
    thickness: number;
    color: string;
    style: LineStyle;
};
export type ResolvedBorderGroup = {
    mode: TableBorderLineMode;
} & LineStyleResolved;
export declare function resolveBorderLine(border: TableNode['border'], group: 'inner' | 'outer'): ResolvedBorderGroup;
export declare function resolveOuterBorderRadius(border: TableNode['border']): number;
export type HorizontalLineStyler = (y: number) => LineStyleResolved | null;
export declare function createHorizontalLineStyler(args: {
    rows: RenderedTableRow[];
    originY: number;
    tableTop: number;
    tableBottom: number;
    headerRows: number;
    headerSeparatorConfig: ContainerBorder | boolean | undefined;
    inner: ResolvedBorderGroup;
    outer: ResolvedBorderGroup;
    roundOuter: boolean;
}): {
    styler: HorizontalLineStyler;
    candidateYs: number[];
};
