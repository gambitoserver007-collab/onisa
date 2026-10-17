// Pruebas de las utilidades de navegador de la auditoría 2026-10:
//   Puerta 13  safeNext: redirección tras el login solo a rutas internas.
//   Puerta 14  csvCell: celdas de CSV que no se ejecutan como fórmulas.
import { describe, expect, it } from "vitest";
import { safeNext } from "../src/lib/safeNext";
import { csvCell } from "../src/lib/csv";

describe("Puerta 13: safeNext", () => {
  it("CONTROL: acepta rutas internas normales", () => {
    expect(safeNext("/pos")).toBe("/pos");
    expect(safeNext("/pos?x=1&y=2")).toBe("/pos?x=1&y=2");
    expect(safeNext("/ventas/abc#detalle")).toBe("/ventas/abc#detalle");
  });

  it("rechaza ausencia, URLs absolutas y '//'", () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext("")).toBeNull();
    expect(safeNext("pos")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("//evil.example")).toBeNull();
  });

  it("rechaza las variantes que el navegador convierte en '//host'", () => {
    expect(safeNext("/\\evil.example")).toBeNull();
    expect(safeNext("/\\/evil.example")).toBeNull();
    expect(safeNext("/\t/evil.example")).toBeNull();
    expect(safeNext("/\n/evil.example")).toBeNull();
    expect(safeNext("/\r/evil.example")).toBeNull();
  });

  it("nunca devuelve algo que el navegador resuelva fuera del origen", () => {
    const hostile = [
      "/\\evil.example",
      "//evil.example",
      "/\t/evil.example",
      "/pos",
      "/%2F/evil.example",
      "/..//evil.example",
    ];

    for (const candidate of hostile) {
      const result = safeNext(candidate);

      if (result !== null) {
        expect(new URL(result, "https://app.test").origin).toBe(
          "https://app.test",
        );
      }
    }
  });
});

describe("Puerta 14: csvCell", () => {
  it("CONTROL: texto y números normales salen entre comillas, sin cambios", () => {
    expect(csvCell("Efectivo")).toBe('"Efectivo"');
    expect(csvCell(12.5)).toBe('"12.5"');
    expect(csvCell("-12.50")).toBe('"-12.50"');
    expect(csvCell(-3)).toBe('"-3"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
  });

  it("neutraliza los textos que empiezan como fórmula", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell("+SUM(A1)")).toBe('"\'+SUM(A1)"');
    expect(csvCell("-2+3")).toBe('"\'-2+3"');
    expect(csvCell("@cmd")).toBe('"\'@cmd"');
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(
      '"\'=HYPERLINK(""http://x"",""clic"")"',
    );
    expect(csvCell("\t=1")).toBe('"\'\t=1"');
  });
});
