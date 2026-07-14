// TextNode: measurement/layout/split (pretext adapter), DOM rendering, and PDF drawing, registered
// as one unit — see behavior.ts for the extension-point contract this implements.
//
// Layout: all text measurement/line-breaking funnels through streamLines(), built on pretext's
// layoutNextLine()/LayoutCursor streaming API — the same mechanism pretext's own README uses for
// flowing text across column/page boundaries. measureHeight/layout/split all call this one helper
// so there is exactly one code path walking the cursor mechanism.
import { layoutNextLine, measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';
import { registerNode } from "../core/behavior.js";
import { styledDiv } from "../render/shadow-dom.js";
import { pxToPt, resolvePdfColor } from "../render/pdf-render.js";
import { measureFontMetricsPx, resolveTextFont, textNodeFontString } from "../render/pdf-fonts.js";
import { resolveActiveFontFamily } from "../render/font-registry.js";
// resolveActiveFontFamily() substitutes the current Paginator instance's own per-instance font alias
// (see font-registry.ts) when this family/weight/style was registerFont()-ed on it — outside of a
// paginate()/mount() call (or when nothing was registered) it's a no-op, returning fontFamily as-is.
function fontString(node) {
    const style = node.fontStyle === 'italic' ? 'italic ' : '';
    const weight = node.fontWeight ?? 400;
    const family = resolveActiveFontFamily(node.fontFamily, weight, node.fontStyle);
    return `${style}${weight} ${node.fontSize}px ${family}`;
}
function preparedFor(node) {
    if (node.__prepared)
        return node.__prepared;
    const prepared = prepareWithSegments(node.content, fontString(node), {
        whiteSpace: node.whiteSpace,
        wordBreak: node.wordBreak,
        letterSpacing: node.letterSpacing,
    });
    node.__prepared = prepared;
    return prepared;
}
function startCursorFor(node) {
    return node.__resumeCursor ?? { segmentIndex: 0, graphemeIndex: 0 };
}
function streamLines(prepared, startCursor, width, maxLines) {
    const lines = [];
    let cursor = startCursor;
    while (lines.length < maxLines) {
        const line = layoutNextLine(prepared, cursor, width);
        if (line === null)
            return { lines, endCursor: cursor, exhausted: true };
        lines.push(line);
        cursor = line.end;
    }
    const probe = layoutNextLine(prepared, cursor, width);
    return { lines, endCursor: cursor, exhausted: probe === null };
}
function positionLines(lines, node, width) {
    return lines.map((line, i) => ({
        x: node.align === 'center' ? (width - line.width) / 2 : node.align === 'right' ? width - line.width : 0,
        y: i * node.lineHeight,
        width: line.width,
        text: line.text,
    }));
}
function fullLines(node, width) {
    const prepared = preparedFor(node);
    const { lines } = streamLines(prepared, startCursorFor(node), width, Infinity);
    return lines;
}
/**
 * Shrink-to-fit width for cross/main-axis sizing in Group/Table layout — the widest forced line,
 * ignoring any wrap constraint entirely (that's the whole point of a "natural"/unconstrained
 * width). For vertical text (`node.orientation` set), this is the POST-rotation footprint
 * (`vwrapWidth()`'s line count × lineHeight) — see that function's own doc comment for why
 * vertical text ignores the ambient width everywhere, making this trivially self-consistent with
 * `layout()`/`measureHeight()` below no matter what any caller passes in.
 */
export function measureTextNaturalWidth(node) {
    if (node.orientation !== undefined)
        return fullLines(node, vwrapWidth(node)).length * node.lineHeight;
    return measureNaturalWidth(preparedFor(node));
}
// Vertical text is atomic (see isSplittable in registerNode() below) and, unlike every other node
// type, never adapts to an ambient width at all — the only thing its layout is ever concerned with
// is its own post-rotation size. Concretely: it always wraps against its OWN intrinsic natural
// width (the widest forced/unwrapped line, exactly what horizontal text's `measureNaturalWidth`
// already computes), never whatever width a parent row/column/margin-note happens to hand it. This
// sidesteps a genuine impossibility otherwise: a row/column child's "ambient width" is used for TWO
// different purposes by the surrounding layout code — the slot size reserved for positioning
// siblings, and the value fed into `layout()`/`measureHeight()` to compute the actual box — and for
// ordinary (non-swapping) types those are the same number by construction, but for a ROTATED node
// they can't be: the slot size needs to be the POST-rotation thickness, while wrapping needs the
// PRE-rotation width. Making vertical text intrinsic (ignoring the ambient width entirely, the same
// way Image/Chart/Svg's own dimensions are never derived from it either) means both concerns
// resolve to the one true size regardless of which number any particular caller passes through.
// One consequence: `alignSelf`/`crossAlign: 'stretch'` has no effect on vertical text (there's no
// ambient width left for it to stretch into) — same documented no-op class as row-child height
// already being intrinsic elsewhere in this file.
function vwrapWidth(node) {
    return measureNaturalWidth(preparedFor(node));
}
function measureHeight(node, width) {
    if (node.orientation !== undefined)
        return vwrapWidth(node);
    return fullLines(node, width).length * node.lineHeight;
}
function layout(node, width) {
    const wrapWidth = node.orientation !== undefined ? vwrapWidth(node) : width;
    const lines = fullLines(node, wrapWidth);
    const contentHeight = lines.length * node.lineHeight;
    const box = node.orientation !== undefined ? { x: 0, y: 0, width: contentHeight, height: wrapWidth } : { x: 0, y: 0, width: wrapWidth, height: contentHeight };
    return { type: 'text', box, node, lines: positionLines(lines, node, wrapWidth) };
}
function split(node, width, availableHeight) {
    const maxLines = Math.floor(availableHeight / node.lineHeight);
    if (maxLines <= 0)
        return null;
    const prepared = preparedFor(node);
    const { lines, endCursor, exhausted } = streamLines(prepared, startCursorFor(node), width, maxLines);
    if (lines.length === 0)
        return null;
    const consumedHeight = lines.length * node.lineHeight;
    const rendered = {
        type: 'text',
        box: { x: 0, y: 0, width, height: consumedHeight },
        node,
        lines: positionLines(lines, node, width),
    };
    const rest = exhausted ? null : { ...node, __prepared: prepared, __resumeCursor: endCursor };
    return { rendered, consumedHeight, rest };
}
function appendLines(container, rendered, font) {
    const node = rendered.node;
    for (const line of rendered.lines) {
        const lineEl = styledDiv({
            left: `${line.x}px`,
            top: `${line.y}px`,
            width: `${line.width}px`,
            height: `${node.lineHeight}px`,
            font,
            lineHeight: `${node.lineHeight}px`,
            color: node.color ?? '#000000',
            letterSpacing: node.letterSpacing !== undefined ? `${node.letterSpacing}px` : 'normal',
            whiteSpace: 'pre',
            ...(node.textDecoration !== undefined && node.textDecoration !== 'none' ? { textDecoration: node.textDecoration } : {}),
        });
        lineEl.textContent = line.text;
        container.appendChild(lineEl);
    }
}
// Renders the ordinary (unrotated) line block sized `wrapWidth × contentHeight`, then rotates it
// into place so its bounding box exactly fills the OUTER box (already swapped by layout() above)
// positioned at (x, y) — the standard "rotate into a swapped bounding box" CSS technique:
// `transform-origin: top left` pins the pivot to the inner block's own top-left corner, and the
// paired `translate()` cancels out the offset that rotating around that pivot would otherwise
// introduce, so the rotated result's bounding box starts flush at (0, 0) of the outer wrapper.
// Empirically verified (headless-browser bounding-box check of this exact rotate()+translate()
// pair): the outer wrapper's box and the rotated inner element's box land pixel-identical.
// `'vertical'` (90° clockwise) reads top-to-bottom down the box's right edge; `'vertical-inverted'`
// (-90°, counter-clockwise) reads bottom-to-top up its left edge (mirroring the common SVG/CSS
// axis-title convention for each direction).
function renderRotatedDom(rendered, x, y, ctx) {
    const node = rendered.node;
    const contentHeight = rendered.box.width; // pre-rotation content height == post-swap width
    const wrapWidth = rendered.box.height; // pre-rotation wrap width == post-swap height
    const outerEl = styledDiv({
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
        ...(ctx.unselectable ? { userSelect: 'none' } : {}),
        ...(ctx.cursor !== undefined ? { cursor: ctx.cursor } : {}),
    });
    const innerEl = styledDiv({
        left: '0px',
        top: '0px',
        width: `${wrapWidth}px`,
        height: `${contentHeight}px`,
        transformOrigin: 'top left',
        transform: node.orientation === 'vertical' ? `rotate(90deg) translate(0px, -${contentHeight}px)` : `rotate(-90deg) translate(-${wrapWidth}px, 0px)`,
    });
    appendLines(innerEl, rendered, fontString(node));
    outerEl.appendChild(innerEl);
    ctx.container.appendChild(outerEl);
}
function renderDom(rendered, x, y, ctx) {
    if (rendered.node.orientation !== undefined) {
        renderRotatedDom(rendered, x, y, ctx);
        return;
    }
    const boxEl = styledDiv({
        left: `${x}px`,
        top: `${y}px`,
        width: `${rendered.box.width}px`,
        height: `${rendered.box.height}px`,
        // `user-select` is inherited, so setting it once here covers every line div below — a drag
        // gesture starting on (or bubbling up through) this text shouldn't also trigger native text
        // selection.
        ...(ctx.unselectable ? { userSelect: 'none' } : {}),
        ...(ctx.cursor !== undefined ? { cursor: ctx.cursor } : {}),
    });
    appendLines(boxEl, rendered, fontString(rendered.node));
    ctx.container.appendChild(boxEl);
}
// pretext's `line.y = i * lineHeight` (positionLines() above) is the TOP of each line's box, not a
// baseline, so the actual PDF baseline is derived from the resolved font's own ascent/descent —
// approximating the CSS half-leading algorithm the browser uses when laying a line box out around a
// font's own metrics: (lineHeight - (ascent+descent)) split evenly above/below the glyphs.
// Best-effort, not a formal guarantee (browsers and canvas's own metrics can disagree by a fraction
// of a pixel).
//
// `baseline: 0` is load-bearing: pdfkit's .text() defaults to treating its `y` argument as the TOP
// of the text box (offsetting down by the font's own ascender internally) to match typical
// word-processor usage — passing `baseline: 0` (pdfkit's "alphabetic" baseline, zero offset) makes
// `y` mean the exact baseline instead, matching this function's own from-scratch baseline math.
// `lineBreak: false` is equally load-bearing: without it, pdfkit defaults `options.width` to the
// remaining page width and re-wraps the string through its own line-breaking engine, silently
// discarding pretext's already-computed line breaks.
function drawPdf(rendered, x, y, ctx) {
    const node = rendered.node;
    const fontName = resolveTextFont(ctx.pdf, node);
    const fontSizePt = pxToPt(node.fontSize);
    const { ascentPx, descentPx } = measureFontMetricsPx(textNodeFontString(node));
    const lineHeightPt = pxToPt(node.lineHeight);
    const ascentPt = pxToPt(ascentPx);
    const fullHeightPt = pxToPt(ascentPx + descentPx);
    const halfLeadingPt = (lineHeightPt - fullHeightPt) / 2;
    const baselineFromTopPt = halfLeadingPt + ascentPt;
    const color = resolvePdfColor(node.color ?? '#000000');
    const characterSpacing = node.letterSpacing !== undefined ? pxToPt(node.letterSpacing) : 0;
    // NOT pdfkit's own `underline`/`strike` .text() options — those compute their line extent from
    // pdfkit's internal line-breaking state, which this file never populates (`lineBreak: false` plus
    // manual per-line positioning, needed to reproduce pretext's already-computed breaks exactly) —
    // confirmed empirically to throw "unsupported number: NaN" inside pdfkit's own fragment/lineTo
    // regardless of font. Drawing the decoration line by hand instead — using `line.width`, which is
    // already known exactly — sidesteps pdfkit's internal state entirely.
    const decoration = node.textDecoration;
    const decorationThicknessPt = Math.max(0.5, fontSizePt * 0.05);
    const doc = ctx.pdf.doc;
    doc.font(fontName).fontSize(fontSizePt).fillColor(color);
    if (node.orientation !== undefined) {
        // Mirrors renderRotatedDom()'s `transform-origin: top left; transform: rotate(θ) translate(...)`
        // exactly: pdfkit's rotate()/translate() compose the same way CSS transform functions do (each
        // subsequent call applies in the already-transformed frame), and pdfkit's rotate() is
        // clockwise-degrees, the same sign convention CSS uses — so this reproduces the DOM path's
        // geometry call-for-call, just as a transform stack instead of a CSS string. Lines are then
        // drawn at LOCAL (0,0)-relative coordinates, since (x, y) is already baked into the stack via
        // the initial translate().
        const angle = node.orientation === 'vertical' ? 90 : -90;
        const contentHeightPt = pxToPt(rendered.box.width); // pre-rotation content height == post-swap width
        const wrapWidthPt = pxToPt(rendered.box.height); // pre-rotation wrap width == post-swap height
        doc.save();
        doc.translate(pxToPt(x), pxToPt(y));
        doc.rotate(angle);
        doc.translate(angle === 90 ? 0 : -wrapWidthPt, angle === 90 ? -contentHeightPt : 0);
        drawLines(doc, rendered, 0, 0, baselineFromTopPt, characterSpacing, decoration, decorationThicknessPt, fontSizePt, color);
        doc.restore();
        return;
    }
    drawLines(doc, rendered, x, y, baselineFromTopPt, characterSpacing, decoration, decorationThicknessPt, fontSizePt, color);
}
function drawLines(doc, rendered, x, y, baselineFromTopPt, characterSpacing, decoration, decorationThicknessPt, fontSizePt, color) {
    for (const line of rendered.lines) {
        const lineTopPt = pxToPt(y + line.y);
        const baselinePt = lineTopPt + baselineFromTopPt;
        const startXPt = pxToPt(x + line.x);
        doc.text(line.text, startXPt, baselinePt, { lineBreak: false, baseline: 0, characterSpacing });
        if (decoration === 'underline' || decoration === 'line-through') {
            const widthPt = pxToPt(line.width);
            const decorationYPt = decoration === 'underline' ? baselinePt + fontSizePt * 0.08 : baselinePt - fontSizePt * 0.3;
            doc
                .moveTo(startXPt, decorationYPt)
                .lineTo(startXPt + widthPt, decorationYPt)
                .lineWidth(decorationThicknessPt)
                .stroke(color);
        }
    }
}
registerNode('text', {
    measureHeight,
    // Vertical text is atomic, like Image/Chart/Svg — splitting a rotated block across a page
    // boundary would mean the split cursor runs the page's vertical axis while lines stack along
    // the page's horizontal axis post-rotation, a confusing case for what's fundamentally a short
    // label use case (see TextNode.orientation's doc comment).
    isSplittable: node => node.orientation === undefined,
    split,
    layout,
    naturalWidth: measureTextNaturalWidth,
    renderDom,
    drawPdf,
});
