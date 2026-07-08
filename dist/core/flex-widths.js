// Shared main-axis sizing math for a ROW group's children (group.ts) and a table's columns
// (table/layout.ts) — same two-pass flex-grow model, different callers. Pure arithmetic with no
// Node-type dispatch, so it carries none of the circular-import concerns node modules have.
/** `availableWidth` should already have any gap total subtracted by the caller. */
export function resolveFlexWidths(sizing, availableWidth) {
    const totalFixed = sizing.reduce((acc, s) => acc + (s.kind === 'fixed' ? s.size : 0), 0);
    const totalFlexWeight = sizing.reduce((acc, s) => acc + (s.kind === 'flex' ? s.weight : 0), 0);
    const remainingForFlex = Math.max(0, availableWidth - totalFixed);
    return sizing.map(s => (s.kind === 'fixed' ? s.size : totalFlexWeight > 0 ? (s.weight / totalFlexWeight) * remainingForFlex : 0));
}
