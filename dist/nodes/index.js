// Side-effect barrel: importing this file (once, before any pagination/rendering call) registers
// every built-in node type with behavior.ts's registry via each module's own registerNode() call.
// Imported first thing from src/index.ts, the public entry point every consumer (including this
// repo's own main.ts) already goes through, so the registry is always fully populated before
// paginate()/mount()/generatePdf() can run.
//
// Adding a new built-in node type: create src/nodes/<type>.ts implementing NodeTypeDefinition and
// calling registerNode('<type>', {...}) at its own bottom, then add one import line here.
import "./text.js";
import "./rich-text.js";
import "./separator.js";
import "./page-break.js";
import "./image.js";
import "./svg.js";
import "./qrcode.js";
import "./barcode.js";
import "./container.js";
import "./group.js";
import "./table/index.js";
import "./chart/index.js";
