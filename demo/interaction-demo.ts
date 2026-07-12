import type { InteractionTarget, PaginatedResult, Paginator, ZoomController } from '../src/index.ts'

// Wires attachInteractions() up to a visible highlight outline (so hovering/clicking is obvious
// without opening devtools) plus console logging (for the full event payloads: node type, box,
// page number, and — for clicks — the ancestor chain). This is a consumer of the public API only,
// the same way an editor built on this library would be — nothing here reaches into internals.
export function setupInteractionDemo(pdfDoc: Paginator, result: PaginatedResult, host: HTMLDivElement, zoom: ZoomController): void {
  const controller = pdfDoc.attachInteractions(result, host, { zoom: zoom.getZoom })
  const registry = pdfDoc.buildHitRegistry(result)
  const shadowRoot = host.shadowRoot!

  function makeHighlightEl(): HTMLElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      border: '2px solid #4f7cff',
      background: 'rgba(79, 124, 255, 0.10)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '10',
    })
    return el
  }

  // A pool rather than one fixed div: a hovered node that was split across pages resolves (via
  // findFragments()) to one InteractionTarget per fragment, each needing its own box on its own
  // page — reused/grown across hovers instead of recreated every time.
  const highlightPool: HTMLElement[] = []

  // Highlights EVERY fragment of the hovered node, not just the one under the pointer — findFragments()
  // is the automatic, id-free counterpart to findById(): degrades to just `target` for a node that
  // was never split, so this is safe to call unconditionally on every hover.
  function showHighlights(targets: InteractionTarget[]): void {
    while (highlightPool.length < targets.length) highlightPool.push(makeHighlightEl())
    highlightPool.forEach((el, i) => {
      const target = targets[i]
      const pageEl = target === undefined ? null : shadowRoot.querySelector<HTMLElement>(`[data-page-number="${target.pageNumber}"]`)
      if (target === undefined || pageEl === null) {
        el.style.display = 'none'
        return
      }
      if (el.parentElement !== pageEl) pageEl.appendChild(el)
      Object.assign(el.style, {
        display: 'block',
        left: `${target.box.x - 5}px`,
        top: `${target.box.y - 5}px`,
        width: `${target.box.width + 10}px`,
        height: `${target.box.height + 10}px`,
      })
    })
  }

  function hideHighlights(): void {
    for (const el of highlightPool) el.style.display = 'none'
  }

  // Separate from `highlight` (which tracks hover) so live valid-drop-zone feedback during a drag
  // doesn't fight with it — green rather than blue, and only ever driven by overDropTarget.
  const dropZoneHighlight = document.createElement('div')
  Object.assign(dropZoneHighlight.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    border: '2px solid #2a9d5c',
    background: 'rgba(42, 157, 92, 0.14)',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '11',
  })

  function showDropZoneHighlight(target: InteractionTarget): void {
    const pageEl = shadowRoot.querySelector<HTMLElement>(`[data-page-number="${target.pageNumber}"]`)
    if (pageEl === null) return
    if (dropZoneHighlight.parentElement !== pageEl) pageEl.appendChild(dropZoneHighlight)
    Object.assign(dropZoneHighlight.style, {
      display: 'block',
      left: `${target.box.x - 5}px`,
      top: `${target.box.y - 5}px`,
      width: `${target.box.width + 10}px`,
      height: `${target.box.height + 10}px`,
    })
  }

  function hideDropZoneHighlight(): void {
    dropZoneHighlight.style.display = 'none'
  }

  controller.on('hover', e => {
    showHighlights(pdfDoc.findFragments(registry, e.target))
    console.log('[hover]', e.target.node.type, e.target.box, `page ${e.target.pageNumber}`)
  })
  controller.on('hoverend', e => {
    hideHighlights()
    console.log('[hoverend]', e.target.node.type)
  })
  controller.on('click', e => {
    console.log(
      '[click]',
      e.target.node.type,
      e.target.box,
      `page ${e.target.pageNumber}`,
      'ancestors:',
      e.target.ancestors.map(a => a.node.type),
    )
  })
  // Drag preview: a floating, pixel-identical copy of whatever's being dragged, built via
  // renderPreview() from the exact RenderedNode subtree the event already carries (target.rendered)
  // — no DOM element lookup needed, since rendering is flat and a group's real DOM element wouldn't
  // include its children's visual content anyway. Positioned with `position: fixed` in viewport
  // coordinates so it tracks the cursor correctly regardless of scroll or which page it strays over.
  let dragPreviewEl: HTMLElement | null = null
  // Logical (unscaled) offset between where the pointer grabbed the node and the node's own
  // top-left — same coordinate space as `e.start`/`e.target.box` (both already divided by zoom,
  // see attach-interactions.ts's getZoom usage). Converted to physical pixels on every position
  // update by multiplying by the *current* zoom, so it stays correct even if the user zooms
  // mid-drag rather than only reflecting the zoom level at dragstart.
  let dragPreviewOffsetX = 0
  let dragPreviewOffsetY = 0

  function positionPreview(clientX: number, clientY: number): void {
    if (dragPreviewEl === null) return
    const currentZoom = zoom.getZoom()
    // renderPreview() builds its copy at natural (unscaled) size — same as every other page
    // element before the page-level `scale(zoom)` transform is applied (see render/zoom.ts). This
    // preview lives outside that transformed subtree (appended to document.body so it can track
    // the cursor via `position: fixed`), so it needs its own matching scale, or it renders at 1x
    // regardless of the current zoom level while everything else on the page is zoomed.
    dragPreviewEl.style.transform = `scale(${currentZoom})`
    dragPreviewEl.style.left = `${clientX - dragPreviewOffsetX * currentZoom}px`
    dragPreviewEl.style.top = `${clientY - dragPreviewOffsetY * currentZoom}px`
  }

  controller.on('dragstart', e => {
    console.log('[dragstart]', e.target.node.type, e.start, 'overDropTarget:', e.overDropTarget?.node.type ?? 'none')

    const preview = pdfDoc.renderPreview(e.target.rendered)
    Object.assign(preview.style, {
      position: 'fixed',
      zIndex: '1000',
      opacity: '0.85',
      transformOrigin: 'top left',
      // `boxShadow` is a non-starter here: it always follows the element's own rectangular box,
      // but renderPreview()'s wrapper has no border-radius of its own (it can't — it's generic
      // across every node type, not just a rounded container/table), so a plain box-shadow would
      // cast a square-cornered halo poking out past a rounded node's actual clipped corners.
      // `drop-shadow` instead follows the alpha shape of what's actually painted inside — the same
      // rounded, clipped shape the borderRadius/overflow:hidden wrapper already produces.
      filter: 'drop-shadow(0 4px 16px rgba(0, 0, 0, 0.3))',
      pointerEvents: 'none',
    })
    document.body.appendChild(preview)
    dragPreviewEl = preview

    // Preserve the offset between where the pointer grabbed the node and the node's own top-left,
    // so the preview doesn't jump to align its corner with the cursor.
    dragPreviewOffsetX = e.start.x - e.target.box.x
    dragPreviewOffsetY = e.start.y - e.target.box.y
    positionPreview(e.sourceEvent.clientX, e.sourceEvent.clientY)

    if (e.overDropTarget !== null) showDropZoneHighlight(e.overDropTarget)
    else hideDropZoneHighlight()
  })
  controller.on('drag', e => {
    console.log('[drag]', e.delta, 'overDropTarget:', e.overDropTarget?.node.type ?? 'none')
    positionPreview(e.sourceEvent.clientX, e.sourceEvent.clientY)

    // Live valid/invalid drop-zone feedback: overDropTarget is already filtered by the dragged
    // node's dragType against each candidate's accepts list, so a type mismatch simply never
    // shows up here — no separate "invalid" check needed on this end.
    if (e.overDropTarget !== null) showDropZoneHighlight(e.overDropTarget)
    else hideDropZoneHighlight()
  })
  controller.on('dragend', e => {
    console.log('[dragend]', e.delta, 'cancelled:', e.cancelled)
    dragPreviewEl?.remove()
    dragPreviewEl = null
    hideDropZoneHighlight()
  })
  controller.on('drop', e => {
    console.log('[drop]', e.target.node.type, '->', e.dropTarget === null ? 'nothing' : e.dropTarget.node.type)
    if (e.dropTarget === null) return
    // Brief green flash on the drop target so a drop landing somewhere is visible without the console.
    showHighlights([e.dropTarget])
    const el = highlightPool[0]!
    const originalBorder = el.style.border
    el.style.border = '2px solid #2a9d5c'
    setTimeout(() => {
      el.style.border = originalBorder
    }, 250)
  })
}
