import type { TableColumn, TableNode, TableRow } from '../../core/nodes.js';
import type { RenderedNode, RenderedTableRow } from '../../core/geometry.js';
import type { SplitOutcome } from '../../core/behavior.js';
export declare function resolveColumnWidths(columns: TableColumn[], width: number): number[];
export declare function resolveRowHeights(rows: TableRow[], columns: TableColumn[], colWidths: number[], cellPadding: number): number[];
export declare function layoutRows(rows: TableRow[], columns: TableColumn[], colWidths: number[], cellPadding: number): RenderedTableRow[];
export declare function measureTableHeight(node: TableNode, width: number): number;
export declare function layoutTable(node: TableNode, width: number): Extract<RenderedNode, {
    type: 'table';
}>;
export declare function splitTable(node: TableNode, width: number, availableHeight: number): SplitOutcome<TableNode>;
