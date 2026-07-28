// Shared, subtle chart palette + styling so Dashboard and Reportes look consistent
// and are easy to read. Greens-forward (brand) with a few harmonious accents.
export const CHART_COLORS = [
  "#149457", // brand green
  "#22B86B", // light green
  "#34B3B0", // teal
  "#F3B85C", // amber
  "#6F9BE8", // soft blue
  "#A788D6", // lavender
];

export const AXIS_PROPS = {
  tick: { fontSize: 12, fill: "#6b7280" },
  axisLine: false,
  tickLine: false,
};

export const GRID_PROPS = {
  strokeDasharray: "3 3",
  vertical: false,
  stroke: "rgba(0,0,0,0.06)",
};

export const TOOLTIP_PROPS = {
  cursor: { fill: "rgba(20,148,87,0.06)" },
  contentStyle: {
    borderRadius: "0.75rem",
    border: "1px solid rgba(0,0,0,0.06)",
    boxShadow: "0 10px 30px rgba(16,24,40,0.10)",
    fontSize: 12,
  },
};

// Dimensión de arranque para ResponsiveContainer (recharts). Sin esto, dentro de
// un grid/flex el contenedor puede medir 0 de ancho en el primer paint y el
// gráfico sale en blanco hasta que un scroll/resize lo vuelve a medir. El
// ResizeObserver interno corrige al tamaño real al instante (256px = alto h-64).
export const CHART_INITIAL_DIMENSION = { width: 600, height: 256 };
