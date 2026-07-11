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
};
export declare function createZoomController(host: HTMLElement, options?: ZoomOptions): ZoomController;
