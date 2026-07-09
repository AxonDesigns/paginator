import type { ChartNode, ContainerBorder, ContainerNode, GroupNode, ImageNode, PageBreakNode, RichTextNode, SeparatorNode, SvgNode, TableNode, TextNode } from './nodes.js';
export type Box = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type PositionedLine = {
    x: number;
    y: number;
    width: number;
    text: string;
};
/** One mixed-style fragment within a richText line — `runIndex` points back into RichTextNode.runs. */
export type PositionedRun = {
    x: number;
    width: number;
    text: string;
    runIndex: number;
};
export type PositionedRichLine = {
    y: number;
    width: number;
    runs: PositionedRun[];
};
export type RenderedTableCell = {
    box: Box;
    rendered: RenderedNode;
    background?: string;
    border?: ContainerBorder;
};
export type RenderedTableRow = {
    kind: 'cells';
    box: Box;
    cells: RenderedTableCell[];
} | {
    kind: 'header';
    box: Box;
    background?: string;
    content?: RenderedNode;
    cells?: RenderedTableCell[];
};
export type RenderedNode = {
    type: 'text';
    box: Box;
    node: TextNode;
    lines: PositionedLine[];
} | {
    type: 'richText';
    box: Box;
    node: RichTextNode;
    lines: PositionedRichLine[];
} | {
    type: 'separator';
    box: Box;
    node: SeparatorNode;
    orientation: 'horizontal' | 'vertical';
} | {
    type: 'group';
    box: Box;
    node: GroupNode;
    children: RenderedNode[];
} | {
    type: 'page-break';
    box: Box;
    node: PageBreakNode;
} | {
    type: 'image';
    box: Box;
    node: ImageNode;
} | {
    type: 'svg';
    box: Box;
    node: SvgNode;
} | {
    type: 'table';
    box: Box;
    node: TableNode;
    rows: RenderedTableRow[];
} | {
    type: 'chart';
    box: Box;
    node: ChartNode;
} | {
    type: 'container';
    box: Box;
    node: ContainerNode;
    child: RenderedNode;
};
export declare function translateRendered(r: RenderedNode, dx: number, dy: number): RenderedNode;
