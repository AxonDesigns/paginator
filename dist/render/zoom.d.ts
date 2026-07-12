export type ZoomOptions = {
    /** Minimum allowed zoom factor. Default 0.5. */
    min?: number;
    /** Maximum allowed zoom factor. Default 2.5. */
    max?: number;
    /** Amount zoomIn()/zoomOut() change the zoom factor by. Default 0.25. */
    step?: number;
    /** Zoom factor applied immediately and restored by reset(). Default 1. */
    initial?: number;
    /** Duration of the zoom/scroll animation, in ms. Default 200. Set to 0 to apply changes instantly. */
    transitionMs?: number;
};
export type ZoomController = {
    /** Current zoom factor — updates every animation frame while a zoom change is in flight. */
    getZoom(): number;
    /** Clamps `value` to [min, max] and animates to it. Returns the target value (immediately, not
     *  the live in-flight value — use getZoom() for that). */
    setZoom(value: number): number;
    /** Increases the zoom factor by `step`, clamped to `max`. Returns the target value. */
    zoomIn(): number;
    /** Decreases the zoom factor by `step`, clamped to `min`. Returns the target value. */
    zoomOut(): number;
    /** Restores the zoom factor to `initial`. Returns the target value. */
    reset(): number;
    /**
     * Computes the zoom factor that fits `pageWidth` (a page's own unscaled px width, e.g.
     * `PaginatedResult.pageSize.width`) within `availableWidth` (defaults to `host.clientWidth` — pass
     * this explicitly if `host` isn't itself the exact width you want to fit within, e.g. it still has
     * its own padding/toolbar chrome) and animates to it, clamped to [min, max] same as setZoom().
     * Returns the target value.
     */
    fitWidth(pageWidth: number, availableWidth?: number): number;
    /**
     * Re-measures `host`'s natural (unscaled) height. Call this after mounting different content into
     * `host` (e.g. a re-paginated document) while this same controller is still in use — `naturalHeight`
     * is otherwise captured once at creation and goes stale, which throws off the below-100%-zoom
     * height compensation (see this file's header comment).
     */
    refresh(): void;
    /**
     * Cancels any in-flight zoom animation. Call when unmounting/discarding `host` while a zoom change
     * might still be animating, so the animation frame loop doesn't keep writing styles to a detached
     * element.
     */
    destroy(): void;
};
export declare function createZoomController(host: HTMLElement, options?: ZoomOptions): ZoomController;
