import type { GroupNode, Node } from '../core/nodes.js';
import type { Box } from '../core/geometry.js';
type LaidOutChild = {
    node: Node;
    box: Box;
};
type DirectionLayoutResult = {
    children: LaidOutChild[];
    contentWidth: number;
    contentHeight: number;
};
export declare function childCrossWidthInColumn(node: Node, width: number): number;
export declare function layoutColumn(node: GroupNode, width: number, targetHeight?: number): DirectionLayoutResult;
export declare function layoutRow(node: GroupNode, width: number): DirectionLayoutResult;
export declare function subtreeHasPageBreak(node: Node): boolean;
export {};
