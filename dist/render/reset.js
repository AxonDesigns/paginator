// Applied first to every element created by the renderer, before any node-specific style. Nothing
// here is class- or stylesheet-based, so there is no selector for a host page's global reset
// (e.g. Tailwind Preflight) to ever match — that's what makes this survive even `!important`
// host rules, on top of the structural isolation Shadow DOM already provides.
export const BASE_ELEMENT_STYLE = {
    boxSizing: 'border-box',
    margin: '0',
    padding: '0',
    border: '0 none',
    position: 'absolute',
};
