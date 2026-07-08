// The pagination / page-breaking algorithm. A single recursive function handles every case:
// a node fits fully, fits partially (Text via pretext's line-cursor split, or a column Group via
// child-boundary split), or doesn't fit at all (atomic nodes and the zero-content orphan case both
// flow entirely to the next page). A node spanning many pages needs no special-casing — it's just
// this function recursing on `rest` repeatedly.
import { translateRendered } from "./geometry.js";
import { isSplittable, layoutNodeFull, measureNodeHeight, splitNode } from "./behavior.js";
import { layoutColumn, subtreeHasPageBreak } from "../nodes/group.js";
import { resolvePageSize } from "./page-sizes.js";
const EPSILON = 0.01;
function startNewPage(ctx) {
    ctx.pages.push([]);
    ctx.y = 0;
}
function placeOnCurrentPage(ctx, rendered, y) {
    ctx.pages[ctx.pages.length - 1].push(translateRendered(rendered, 0, y));
}
function paginateNode(node, width, ctx) {
    // A bare top-level page break (unusual authoring — e.g. doc.body or a `rest` continuation is
    // literally just pageBreak() with nothing else) has no surrounding content in this frame to cut
    // away from, so it's handled directly rather than through the natural-height/split machinery
    // below: force a break unless the current page is still completely empty.
    if (node.type === 'page-break') {
        if (ctx.y > 0)
            startNewPage(ctx);
        return;
    }
    const remaining = ctx.contentBoxHeight - ctx.y;
    const atTopOfFreshPage = ctx.y === 0;
    const naturalHeight = measureNodeHeight(node, width);
    // Case 1: fits fully on the current page. Guarded by subtreeHasPageBreak so an explicit page
    // break nested inside content that would otherwise fit on one page still gets honored, instead
    // of being silently absorbed by this fast path.
    if (naturalHeight <= remaining + EPSILON && !subtreeHasPageBreak(node)) {
        placeOnCurrentPage(ctx, layoutNodeFull(node, width), ctx.y);
        ctx.y += naturalHeight;
        return;
    }
    // Case 2: atomic (non-splittable) node — Separator, or Row Group.
    if (!isSplittable(node)) {
        if (atTopOfFreshPage) {
            // Pathological: taller than a whole empty page. Render anyway, overflow, warn.
            placeOnCurrentPage(ctx, layoutNodeFull(node, width), ctx.y);
            ctx.y += naturalHeight;
            console.warn(`[paginator] "${node.type}" node (${naturalHeight}px) exceeds the full page content height (${ctx.contentBoxHeight}px) and will overflow.`);
            return;
        }
        startNewPage(ctx);
        paginateNode(node, width, ctx);
        return;
    }
    // Case 3: splittable (Text, or a column Group) — consume as much as fits.
    const splitResult = splitNode(node, width, remaining);
    if (splitResult === null) {
        // Orphan rule: zero content fits in the remaining space.
        if (atTopOfFreshPage) {
            placeOnCurrentPage(ctx, layoutNodeFull(node, width), ctx.y);
            ctx.y += naturalHeight;
            console.warn(`[paginator] "${node.type}" node cannot fit even a single unit (line/child) within a full page and will overflow.`);
            return;
        }
        startNewPage(ctx);
        paginateNode(node, width, ctx);
        return;
    }
    // Partial fit: place what fit, continue the remainder on the next page.
    placeOnCurrentPage(ctx, splitResult.rendered, ctx.y);
    ctx.y += splitResult.consumedHeight;
    startNewPage(ctx);
    if (splitResult.rest !== null)
        paginateNode(splitResult.rest, width, ctx);
}
function resolveHeaderFooterContentNode(content, pageNumber, totalPages) {
    if (content === undefined)
        return null;
    return typeof content === 'function' ? content({ pageNumber, totalPages }) : content;
}
function resolveHeaderFooterHeight(content, width) {
    const node = resolveHeaderFooterContentNode(content, 1, 1);
    if (node === null)
        return 0;
    return measureNodeHeight(node, width);
}
function renderHeaderFooterForPage(content, width, pageNumber, totalPages) {
    const node = resolveHeaderFooterContentNode(content, pageNumber, totalPages);
    if (node === null)
        return null;
    return layoutNodeFull(node, width);
}
// Shared by watermark/background/border — all three are page-varying-aware the same way header/
// footer content is (a plain value, or a `{pageNumber, totalPages}` callback producing one), just
// without header/footer's extra Node-layout step. The callback form may also return undefined/null
// to opt a specific page out entirely (e.g. a watermark only on page 1) — `?? null` normalizes that
// alongside the "no content configured at all" case, so callers only ever check a single `=== null`.
function resolvePerPageValue(content, pageNumber, totalPages) {
    if (content === undefined)
        return null;
    const resolved = typeof content === 'function' ? content({ pageNumber, totalPages }) : content;
    return resolved ?? null;
}
// Single-page body `mainAlign` centering: applied as an isolated post-processing pass so the
// pagination recursion itself never special-cases it. For multi-page documents this has no
// well-defined single-page meaning and is left as `start`-equivalent packing (documented).
function applySinglePageBodyMainAlign(body, pages, contentBoxWidth, contentBoxHeight) {
    if (pages.length !== 1 || body.type !== 'group' || body.direction !== 'column')
        return;
    const mainAlign = body.mainAlign ?? 'start';
    if (mainAlign === 'start')
        return;
    const { children } = layoutColumn(body, contentBoxWidth, contentBoxHeight);
    pages[0] = children.map(c => translateRendered(layoutNodeFull(c.node, c.box.width), c.box.x, c.box.y));
}
export function paginate(doc) {
    const { width: pageWidth, height: pageHeight } = resolvePageSize(doc.size);
    const contentBoxWidth = pageWidth - doc.margins.left - doc.margins.right;
    const headerHeight = doc.headerHeight ?? resolveHeaderFooterHeight(doc.header, contentBoxWidth);
    const footerHeight = doc.footerHeight ?? resolveHeaderFooterHeight(doc.footer, contentBoxWidth);
    const headerGap = doc.headerGap ?? 0;
    const footerGap = doc.footerGap ?? 0;
    const contentBoxHeight = pageHeight - doc.margins.top - doc.margins.bottom - headerHeight - headerGap - footerHeight - footerGap;
    if (contentBoxHeight <= 0) {
        throw new Error('[paginator] page content box has zero/negative height — margins/header/footer too large for the chosen page size.');
    }
    const ctx = { pages: [[]], y: 0, contentBoxWidth, contentBoxHeight };
    paginateNode(doc.body, contentBoxWidth, ctx);
    applySinglePageBodyMainAlign(doc.body, ctx.pages, contentBoxWidth, contentBoxHeight);
    const totalPages = ctx.pages.length;
    const pages = ctx.pages.map((body, i) => ({
        pageNumber: i + 1,
        header: renderHeaderFooterForPage(doc.header, contentBoxWidth, i + 1, totalPages),
        body,
        footer: renderHeaderFooterForPage(doc.footer, contentBoxWidth, i + 1, totalPages),
        watermark: resolvePerPageValue(doc.watermark, i + 1, totalPages),
        background: resolvePerPageValue(doc.background, i + 1, totalPages),
        border: resolvePerPageValue(doc.border, i + 1, totalPages),
    }));
    return {
        pageSize: { width: pageWidth, height: pageHeight },
        margins: doc.margins,
        headerHeight,
        footerHeight,
        headerGap,
        footerGap,
        pages,
    };
}
