// The public facade: a Paginator instance owns its own font registry (the one piece of state that
// actually needs isolation — see font-registry.ts's header comment) and exposes the whole
// pagination/render/interaction pipeline as instance methods, so multiple independent Paginators can
// run side by side without one instance's registerFont()/generatePdf() calls corrupting another's.
//
// Everything else this delegates to (paginate(), mount(), attachInteractions(), the hit-registry
// functions, the pdf-view helpers) has no module-level state of its own — they're grouped here as
// methods purely for one consistent object-oriented entry point, not because they need `this`.
//
// Deliberately NOT part of this class: node builders (definePage/text/group/... — pure content
// constructors with no state, see core/nodes.ts) and setLocale/clearCache (re-exported directly from
// @chenglou/pretext — that library's own global, with no instance-scoped equivalent to wrap).
import { paginate as corePaginate } from "./core/paginate.js";
import { mount as coreMount, printDocument as corePrintDocument, renderPreview as coreRenderPreview } from "./render/shadow-dom.js";
import { generatePdf as coreGeneratePdf } from "./render/pdf-render.js";
import { generateDocx as coreGenerateDocx } from "./export/docx-export.js";
import { generateXlsx as coreGenerateXlsx } from "./export/xlsx-export.js";
import { listRegisteredFonts as coreListRegisteredFonts, registerFont as coreRegisterFont } from "./render/font-registry.js";
import { attachInteractions as coreAttachInteractions } from "./interaction/attach-interactions.js";
import { buildHitRegistry as coreBuildHitRegistry, findById as coreFindById, hitTest as coreHitTest, hitTestDroppable as coreHitTestDroppable, toTypeList as coreToTypeList, } from "./interaction/hit-registry.js";
import { openPdfInNewTab as coreOpenPdfInNewTab, showPdfDialog as coreShowPdfDialog } from "./render/pdf-view.js";
export class Paginator {
    #fonts = new Map();
    registerFont(options) {
        return coreRegisterFont(this.#fonts, options);
    }
    listRegisteredFonts() {
        return coreListRegisteredFonts(this.#fonts);
    }
    paginate(doc) {
        return corePaginate(doc);
    }
    mount(result, host) {
        coreMount(result, host);
    }
    renderPreview(rendered) {
        return coreRenderPreview(rendered);
    }
    printDocument(host) {
        corePrintDocument(host);
    }
    attachInteractions(result, host, options = {}) {
        return coreAttachInteractions(result, host, options);
    }
    buildHitRegistry(result) {
        return coreBuildHitRegistry(result);
    }
    hitTest(registry, pageNumber, x, y) {
        return coreHitTest(registry, pageNumber, x, y);
    }
    hitTestDroppable(registry, pageNumber, x, y, dragTypes = []) {
        return coreHitTestDroppable(registry, pageNumber, x, y, dragTypes);
    }
    findById(registry, id) {
        return coreFindById(registry, id);
    }
    toTypeList(value) {
        return coreToTypeList(value);
    }
    generatePdf(result, metadata) {
        return coreGeneratePdf(result, this.#fonts, metadata);
    }
    // Unlike generatePdf/mount, these take the pre-pagination PageDef directly rather than a
    // PaginatedResult — Word/Excel reflow content themselves (see src/export/docx-export.ts's header
    // comment), so there's no pixel-box pagination step to run first.
    generateDocx(doc, metadata) {
        return coreGenerateDocx(doc, metadata);
    }
    generateXlsx(doc, metadata) {
        return coreGenerateXlsx(doc, metadata);
    }
    openPdfInNewTab(bytes) {
        coreOpenPdfInNewTab(bytes);
    }
    showPdfDialog(bytes, options) {
        return coreShowPdfDialog(bytes, options);
    }
}
