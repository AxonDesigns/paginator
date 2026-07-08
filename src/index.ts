import './nodes/index.ts'

export { definePage, group, text, richText, separator, pageBreak, image, svg, container, table, chart, rowGroup } from './core/nodes.ts'
export { ready } from './ready.ts'
// Pretext's own module-global locale/measurement-cache state — no instance-scoped equivalent
// exists, so this is deliberately not wrapped by Paginator (see paginator.ts's header comment).
export { setLocale, clearCache } from '@chenglou/pretext'
export { normalizeFontWeight } from './render/font-registry.ts'
export { Paginator } from './paginator.ts'

export type {
  PageDef,
  Margins,
  PageSize,
  HeaderFooterContext,
  HeaderFooterContent,
  Watermark,
  TextWatermark,
  ImageWatermark,
  WatermarkContent,
  Node,
  GroupNode,
  RowGroupNode,
  ColumnGroupNode,
  TextNode,
  RichTextNode,
  RichTextRun,
  RichInlineCursorLike,
  SeparatorNode,
  PageBreakNode,
  ImageNode,
  SvgNode,
  ContainerNode,
  ContainerBorder,
  TableNode,
  TableColumn,
  TableRow,
  TableCell,
  TableBorderMode,
  TableGroupLevel,
  ChartText,
  ChartTextRun,
  ChartNode,
  CategoricalChartNode,
  RadialChartNode,
  ChartRing,
  ChartRingSlice,
  ScatterChartNode,
  ChartScatterPoint,
  ChartScatterSeries,
  ChartSizeScaleConfig,
  ChartNumericAxisConfig,
  GanttChartNode,
  ChartGanttTask,
  ChartGanttGroupStyle,
  RadarChartNode,
  ChartRadarSeries,
  CandlestickChartNode,
  ChartCandle,
  ChartCandlestickSeries,
  TreemapChartNode,
  ChartTreemapItem,
  ChartKind,
  ChartSeries,
  ChartSeriesKind,
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
export type { RenderedNode, Box, PositionedLine, PositionedRun, PositionedRichLine, RenderedTableRow, RenderedTableCell } from './core/geometry.ts'
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
export type { DocxMetadata } from './export/docx-export.ts'
export type { XlsxMetadata } from './export/xlsx-export.ts'
export type { RegisteredFont, FontStyle } from './render/font-registry.ts'
