// Custom web fonts must be loaded before pretext measures text with them, or measurement falls
// back to substitute-font metrics. Every pretext demo gates its first prepare() call on this.
export async function ready() {
    await document.fonts.ready;
}
