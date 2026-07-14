import { table, text, type TextAlign } from "../../src";

export interface Product {
    name: string;
    category: string;
    unitsSold: number;
    revenue: number;
}

export const PRODUCTS: Product[] = [
    { name: "Aurora Desk Lamp", category: "Lighting", unitsSold: 1240, revenue: 37200 },
    { name: "Nimbus Office Chair", category: "Seating", unitsSold: 860, revenue: 129000 },
    { name: "Basalt Standing Desk", category: "Desks", unitsSold: 540, revenue: 216000 },
    { name: "Halo Monitor Arm", category: "Accessories", unitsSold: 1980, revenue: 59400 },
    { name: "Cinder Bookshelf", category: "Storage", unitsSold: 410, revenue: 82000 },
];

const currency = (value: number) => `$${value.toLocaleString("en-US")}`;

function cellText(
    content: string,
    opts: { bold?: boolean; align?: TextAlign; interactive?: boolean; metadata?: Record<string, unknown>; id?: string } = {},
) {
    return text({
        content,
        fontFamily: "Helvetica",
        fontSize: 11,
        fontWeight: opts.bold ? 700 : 400,
        lineHeight: 15,
        align: opts.align ?? "left",
        color: opts.interactive ? "#1d4ed8" : "#0f172a",
        interactive: opts.interactive,
        metadata: opts.metadata,
        id: opts.id,
    });
}

export const salesTable = table({
    columns: [
        { content: cellText("Product", { bold: true }), width: 3 },
        { content: cellText("Category", { bold: true }), width: 2 },
        { content: cellText("Units sold", { bold: true, align: "right" }), width: 1.4, align: "end" },
        { content: cellText("Revenue", { bold: true, align: "right" }), width: 1.4, align: "end" },
    ],
    headerBackground: "#f1f5f9",
    border: {
        inner: { mode: "horizontal", color: "#e2e8f0" },
        outer: { mode: "all", color: "#cbd5e1", thickness: 10 },
    },
    stripe: { even: "#ffffff", odd: "#f8fafc" },
    cellPadding: 8,
    rows: PRODUCTS.map((product, index) => ({
        cells: [
            {
                content: cellText(product.name, {
                    interactive: true,
                    id: `product-${index}`,
                    metadata: { ...product },
                }),
            },
            { content: cellText(product.category) },
            { content: cellText(String(product.unitsSold), { align: "right" }) },
            { content: cellText(currency(product.revenue), { align: "right" }) },
        ],
    })),
});