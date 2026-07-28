import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import landingHtml from "./landing.html?raw";

/**
 * Página de ventas (landing) de Tienda Ágil.
 *
 * El marcado + estilos viven en `landing.html` (todo el CSS está scopeado bajo
 * `.tienda-landing`). Regla de robustez: TODO el contenido es visible sin
 * depender de JavaScript. Este efecto solo agrega mejoras opcionales (contador
 * animado, parallax, navegación SPA); si no llegara a correr, la landing se ve
 * y funciona igual (los números salen fijos, los enlaces navegan por href).
 */
export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // Ref para usar el navigate más reciente sin re-ejecutar el efecto.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const cleanups: Array<() => void> = [];

    // Contadores animados. Si el observador no dispara, el HTML ya trae el número real.
    const countIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const target = Number(el.dataset.count ?? "0");
          const start = performance.now();
          const step = (now: number) => {
            const p = Math.min((now - start) / 1400, 1);
            el.textContent = Math.floor(p * target).toLocaleString("es");
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          countIO.unobserve(el);
        });
      },
      { threshold: 0.5 },
    );
    root.querySelectorAll("[data-count]").forEach((el) => countIO.observe(el));
    cleanups.push(() => countIO.disconnect());

    // Parallax sutil de la figura del hero.
    const shape = root.querySelector<HTMLElement>(".floating-shape");
    const onScroll = () => {
      const y = window.scrollY;
      if (shape && y < 900) shape.style.transform = `translateY(${y * 0.12}px)`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener("scroll", onScroll));

    // Enlaces internos → navegación SPA (con href como respaldo si el JS no corre).
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      event.preventDefault();
      navigateRef.current({ to: href });
    };
    root.addEventListener("click", onClick);
    cleanups.push(() => root.removeEventListener("click", onClick));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <div
      ref={rootRef}
      className="tienda-landing"
      dangerouslySetInnerHTML={{ __html: landingHtml }}
    />
  );
}

export default LandingPage;
