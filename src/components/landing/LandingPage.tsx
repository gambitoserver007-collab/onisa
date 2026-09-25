import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import landingHtml from "./landing.html?raw";
import { fetchPlans, type SubscriptionPlan } from "@/services/appData";

const UNLIMITED = 1_000_000;
const formatCount = (n: number) =>
  n >= UNLIMITED ? "Ilimitado" : n.toLocaleString("es");

const formatPrice = (price: number) =>
  `$${price.toLocaleString("es-MX", {
    minimumFractionDigits: price % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const limitsText = (plan: SubscriptionPlan) =>
  `${formatCount(plan.productLimit)} productos, ${formatCount(plan.userLimit)} ${
    plan.userLimit === 1 ? "usuario" : "usuarios"
  } y ${formatCount(plan.salesLimit)} ventas/mes`;

// Sustituye los precios/límites de respaldo (fijos en el HTML) por los
// reales de subscription_plans, en el mismo orden (precio ascendente) en
// que ya vienen las tarjetas estáticas. Si algo falla o no hay datos, se
// deja el respaldo tal cual -- por eso nunca se lanza el error hacia afuera.
function applyRealPlanPrices(root: HTMLElement, plans: SubscriptionPlan[]) {
  const cards = root.querySelectorAll<HTMLElement>("#planes .plan");

  plans.slice(0, cards.length).forEach((plan, i) => {
    const card = cards[i];
    const nameEl = card.querySelector("h3");
    const priceEl = card.querySelector(".price");
    const limitsEl = card.querySelector("ul li:first-child");

    if (nameEl) nameEl.textContent = plan.name;
    if (priceEl)
      priceEl.innerHTML = `${formatPrice(plan.price)}<small>/mes</small>`;

    if (limitsEl) {
      const iconHtml = limitsEl.querySelector("svg")?.outerHTML ?? "";
      limitsEl.innerHTML = `${iconHtml} ${limitsText(plan)}`;
    }
  });
}

/**
 * Página de ventas (landing) de Onisa.
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

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as HTMLElement)?.closest("a");

      if (!anchor) return;
      const href = anchor.getAttribute("href");

      if (!href || !href.startsWith("/")) return;
      event.preventDefault();
      navigateRef.current({ to: href });
    };

    root.addEventListener("click", onClick);
    cleanups.push(() => root.removeEventListener("click", onClick));

    // Precios reales: la landing arranca con los de respaldo (fijos en el
    // HTML) y, si el fetch a subscription_plans llega a tiempo, los
    // reemplaza -- así nunca se desincroniza de lo que se configura en
    // /admin/planes.
    let cancelled = false;

    void fetchPlans()
      .then((plans) => {
        if (!cancelled) applyRealPlanPrices(root, plans);
      })
      .catch(() => {
        // Sin conexión o error: se queda con los precios de respaldo.
      });
    cleanups.push(() => {
      cancelled = true;
    });

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
