import "./nodes/index.js";
export { definePage, group, text, richText, separator, pageBreak, image, svg, qrcode, barcode, container, table, chart, rowGroup } from "./core/nodes.js";
export { ready } from "./ready.js";
// Pretext's own module-global locale/measurement-cache state — no instance-scoped equivalent
// exists, so this is deliberately not wrapped by Paginator (see paginator.ts's header comment).
export { setLocale, clearCache } from '@chenglou/pretext';
export { normalizeFontWeight } from "./render/font-registry.js";
export { Paginator } from "./paginator.js";
