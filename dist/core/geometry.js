// Resolved layout geometry — always page-content-box-relative by the time pagination finishes.
export function translateRendered(r, dx, dy) {
    const box = { x: r.box.x + dx, y: r.box.y + dy, width: r.box.width, height: r.box.height };
    if (r.type === 'group') {
        return { ...r, box, children: r.children.map(c => translateRendered(c, dx, dy)) };
    }
    if (r.type === 'table') {
        return {
            ...r,
            box,
            rows: r.rows.map((row) => {
                const rowBox = { x: row.box.x + dx, y: row.box.y + dy, width: row.box.width, height: row.box.height };
                const translateCells = (cells) => cells.map(cell => ({
                    ...cell,
                    box: { x: cell.box.x + dx, y: cell.box.y + dy, width: cell.box.width, height: cell.box.height },
                    rendered: translateRendered(cell.rendered, dx, dy),
                }));
                if (row.kind === 'header') {
                    return {
                        ...row,
                        box: rowBox,
                        content: row.content === undefined ? undefined : translateRendered(row.content, dx, dy),
                        cells: row.cells === undefined ? undefined : translateCells(row.cells),
                    };
                }
                return { ...row, box: rowBox, cells: translateCells(row.cells) };
            }),
        };
    }
    if (r.type === 'container') {
        return { ...r, box, child: translateRendered(r.child, dx, dy) };
    }
    return { ...r, box };
}
