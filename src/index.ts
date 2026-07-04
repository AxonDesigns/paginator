export { definePage, group, text, separator, pageBreak, image, table, chart, rowGroup } from './core/nodes.ts'
export { paginate } from './core/paginate.ts'
export { mount, renderPreview, printDocument } from './render/shadow-dom.ts'
export { ready } from './ready.ts'
export { setLocale, clearCache } from '@chenglou/pretext'
export { attachInteractions } from './interaction/attach-interactions.ts'
export { buildHitRegistry, hitTest, hitTestDroppable, toTypeList } from './interaction/hit-registry.ts'
export { generatePdf } from './render/pdf-render.ts'
export { registerFont, normalizeFontWeight, listRegisteredFonts } from './render/font-registry.ts'
export { openPdfInNewTab, showPdfDialog } from './render/pdf-view.ts'

export type {
  PageDef,
  Margins,
  PageSize,
  HeaderFooterContext,
  HeaderFooterContent,
  Node,
  GroupNode,
  RowGroupNode,
  ColumnGroupNode,
  TextNode,
  SeparatorNode,
  PageBreakNode,
  ImageNode,
  TableNode,
  TableColumn,
  TableRow,
  TableCell,
  TableBorderMode,
  TableGroupLevel,
  ChartNode,
  BarChartNode,
  LineChartNode,
  PieChartNode,
  DonutChartNode,
  CategoricalChartNode,
  RadialChartNode,
  ChartKind,
  ChartSeries,
  ChartSeriesFillConfig,
  ChartSlice,
  ChartAxisConfig,
  ChartViewConfig,
  ChartLegendConfig,
  ChartTitleConfig,
  ObjectFit,
  MainAlign,
  CrossAlign,
  TextAlign,
  FlexSize,
  Interactive,
} from './core/nodes.ts'
export type { RenderedNode, Box, PositionedLine, RenderedTableRow, RenderedTableCell } from './core/geometry.ts'
export type { PaginatedResult, PaginatedPage } from './core/paginate.ts'
export type {
  InteractionController,
  InteractionTarget,
  InteractionAncestor,
  InteractionRegion,
  InteractionEventMap,
  HoverEvent,
  HoverEndEvent,
  ClickEvent,
  DragStartEvent,
  DragMoveEvent,
  DragEndEvent,
  DropEvent,
  AttachInteractionsOptions,
  PagePoint,
} from './interaction/types.ts'
export type { HitRegistry } from './interaction/hit-registry.ts'
export type { PdfMetadata } from './render/pdf-render.ts'
export type { RegisteredFont, FontStyle } from './render/font-registry.ts'
