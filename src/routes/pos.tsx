import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Store, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { MobileSaleCart, SaleCart } from "@/components/pos/SaleCart";
import { ProductCatalog } from "@/components/pos/ProductCatalog";
import { VariantSelectorDialog } from "@/components/pos/VariantSelectorDialog";
import { PriceCheckDialog } from "@/components/pos/PriceCheckDialog";
import { ProductSearchDialog } from "@/components/pos/ProductSearchDialog";
import { SuccessOverlay } from "@/components/feedback/SuccessOverlay";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { blockDemoAction } from "@/lib/demoMode";
import { getProductImage } from "@/lib/productVisuals";
import { DEFAULT_DOCUMENT_TYPES } from "@/data/markets";
import {
  createCustomer,
  createSaleFromCart,
  fetchAllComboItems,
  fetchLocationStock,
  fetchLocationVariantStock,
  fetchOpenCashSession,
  fetchProductVariants,
  fetchPromotions,
  getErrorMessage,
  type ComboItemRow,
  type Promotion,
  type SalePaymentLine,
} from "@/services/appData";
import type { CartItem, Product, ProductVariant, Sale } from "@/types";

export const Route = createFileRoute("/pos")({ component: POS });

type SaleDocumentType = Sale["type"];
type PaymentMethod = Sale["method"];

// 3 "ventanas" de venta simultáneas en el POS -- ver el efecto de
// sincronización de pestañas más abajo.
const SLOT_COUNT = 3;

interface SaleSlot {
  cart: CartItem[];
  customerId: string;
  docType: string;
  method: string;
  pointsToRedeem: number;
  splitMode: boolean;
  splitPayments: SalePaymentLine[];
}

function makeEmptySlot(): SaleSlot {
  return {
    cart: [],
    customerId: "",
    docType: "",
    method: "Efectivo",
    pointsToRedeem: 0,
    splitMode: false,
    splitPayments: [],
  };
}

// Un Servicio nunca maneja inventario -- este número solo evita que la
// lógica de "no pasarse del stock" del carrito lo bloquee; nunca se muestra
// al cajero (ProductCatalog oculta el stock para todo lo que no sea Estándar).
const SERVICE_STOCK_SENTINEL = 999999;

// Huella del carrito para decidir si un cobro es "el mismo intento" (reintento
// tras un error de red) o uno nuevo. No incluye cliente/método/tipo de
// documento a propósito: cambiar esos campos entre reintentos del mismo
// carrito no debe generar una venta duplicada.
function cartSignature(items: CartItem[]) {
  return items
    .map(
      (item) =>
        `${item.productId}:${item.variantId ?? ""}:${item.qty}:${item.price}`,
    )
    .sort()
    .join("|");
}

function POS() {
  const navigate = useNavigate();
  const { formatMoney, settings } = useBusinessSettings();
  const { isDemo, session, role } = useDemoSession();
  const { products, customers, error, source, isLoading, reload } =
    useCompanyCatalog();
  const { activeMethods } = usePaymentMethods(settings.countryCode);
  const { currentLocationId, locations } = useCurrentLocation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [comboItems, setComboItems] = useState<ComboItemRow[]>([]);
  const [docType, setDocType] = useState<SaleDocumentType>("");
  const [method, setMethod] = useState<PaymentMethod>("Efectivo");
  const [splitMode, setSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SalePaymentLine[]>([]);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [success, setSuccess] = useState<{ amount: number; id: string } | null>(
    null,
  );
  // Clave de idempotencia del cobro en curso: se mantiene igual mientras el
  // carrito no cambie, para que un reintento tras un error de red reutilice
  // la misma venta en vez de duplicarla (ver create_sale, p_client_request_id).
  const pendingSaleRef = useRef<{ key: string; signature: string } | null>(
    null,
  );
  // Atajos de teclado (F4/F6/F9/F10): cobrar, cambiar de venta, verificador
  // de precios y buscador de productos.
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  // Un lector de código de barras físico solo "escribe" en el elemento que
  // tenga el foco. Cada click en el catálogo o en el carrito (agregar,
  // +/-, quitar) se lo roba, así que el siguiente escaneo se pierde hasta
  // que el cajero vuelve a hacer click manualmente en el buscador. Se
  // reenfoca ahí después de cada una de esas acciones rápidas.
  const scanInputRef = useRef<HTMLInputElement>(null);
  const refocusScanner = () => {
    requestAnimationFrame(() => scanInputRef.current?.focus());
  };
  // Stock del punto de venta activo: Map product_id -> stock (null = sin cargar).
  const [locationStock, setLocationStock] = useState<Map<
    string,
    number
  > | null>(null);
  // Stock de variantes en la sucursal: por producto (para el catálogo) y por variante.
  const [variantStockByProduct, setVariantStockByProduct] = useState<
    Map<string, number>
  >(new Map());
  const [variantStockByVariant, setVariantStockByVariant] = useState<
    Map<string, number>
  >(new Map());
  // Índice de códigos de barras de variantes → {product, variant}, para escanear variantes.
  const [variantBarcodeIndex, setVariantBarcodeIndex] = useState<
    Map<string, { product: Product; variant: ProductVariant }>
  >(new Map());
  // Selección de variante (cuando se toca un producto con variantes).
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingVariants, setPendingVariants] = useState<ProductVariant[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);

  // El cajero vende en su local asignado; el admin usa el local activo del
  // selector. "Todas las tiendas" no aplica al vender → exige elegir una.
  const resolvedLocationId =
    currentLocationId === ALL_LOCATIONS ? null : currentLocationId;
  const posLocationId =
    role === "admin"
      ? resolvedLocationId
      : (session?.locationId ?? resolvedLocationId);
  // Si la sucursal asignada/activa fue desactivada (ya no está en la lista de activas),
  // no se puede vender ahí. Durante la carga (lista vacía) no se bloquea.
  const posLocationInactive =
    !!posLocationId &&
    locations.length > 0 &&
    !locations.some((loc) => loc.id === posLocationId);

  // No se puede vender sin una caja abierta en esta sucursal. null = todavía
  // no se sabe (no bloquea mientras carga, para no parpadear); false = se
  // confirmó que no hay caja abierta, ahí sí se bloquea la pantalla entera.
  const [hasOpenCashSession, setHasOpenCashSession] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    if (!session?.companyId || !posLocationId) {
      setHasOpenCashSession(null);
      return;
    }
    let active = true;
    setHasOpenCashSession(null);
    void fetchOpenCashSession(session.companyId, posLocationId)
      .then((result) => {
        if (active) setHasOpenCashSession(!!result);
      })
      .catch(() => {
        if (active) setHasOpenCashSession(null);
      });
    return () => {
      active = false;
    };
  }, [session?.companyId, posLocationId]);

  const reloadLocationStock = useCallback(async () => {
    if (!posLocationId) {
      setLocationStock(null);
      return;
    }
    try {
      const [base, variant] = await Promise.all([
        fetchLocationStock(posLocationId),
        fetchLocationVariantStock(posLocationId),
      ]);
      setLocationStock(base);
      setVariantStockByProduct(variant.byProduct);
      setVariantStockByVariant(variant.byVariant);
    } catch {
      setLocationStock(null);
    }
  }, [posLocationId]);

  useEffect(() => {
    void reloadLocationStock();
  }, [reloadLocationStock]);

  // Índice de códigos de barras de variantes, para poder escanearlas en el POS.
  useEffect(() => {
    const variantProducts = products.filter((p) => p.hasVariants);
    if (!variantProducts.length) {
      setVariantBarcodeIndex(new Map());
      return;
    }
    let active = true;
    void Promise.all(
      variantProducts.map((p) =>
        fetchProductVariants(p.id)
          .then((vs) => ({ p, vs }))
          .catch(() => ({ p, vs: [] as ProductVariant[] })),
      ),
    ).then((results) => {
      if (!active) return;
      const idx = new Map<
        string,
        { product: Product; variant: ProductVariant }
      >();
      for (const { p, vs } of results) {
        for (const v of vs) {
          if (v.barcode) idx.set(v.barcode.trim(), { product: p, variant: v });
        }
      }
      setVariantBarcodeIndex(idx);
    });
    return () => {
      active = false;
    };
  }, [products]);

  // Comprobantes configured for this store (fallback when none yet).
  const documentTypes = session?.documentTypes?.length
    ? session.documentTypes
    : DEFAULT_DOCUMENT_TYPES;

  useEffect(() => {
    // Clear any selected customer that isn't in the current company's list.
    // Prevents a stale demo placeholder (e.g. "cl0") from the initial catalog
    // from being sent to Supabase as an invalid UUID after real data loads.
    if (customer && !customers.some((entry) => entry.id === customer)) {
      setCustomer("");
    }
  }, [customer, customers]);

  // Cambiar de cliente invalida cualquier canje de puntos que se había
  // preparado para el cliente anterior.
  useEffect(() => {
    setPointsToRedeem(0);
  }, [customer]);

  // Default the comprobante to the first one the store has configured.
  useEffect(() => {
    if (!docType && documentTypes.length) setDocType(documentTypes[0].name);
  }, [docType, documentTypes]);

  // 3 "ventanas" de venta simultáneas -- cambiar de pestaña es instantáneo
  // (sin pausar/retomar) para no frenar el flujo cuando hay varios clientes
  // esperando. Cada pestaña guarda su propio carrito completo; viven solo
  // en este dispositivo (localStorage), escopeadas por empresa. No
  // reservan stock -- se valida hasta que se cobran, igual que siempre.
  const slotsKey = session?.companyId
    ? `ventapro:sale-slots:${session.companyId}`
    : null;
  const [activeSlot, setActiveSlot] = useState(0);
  const [slots, setSlots] = useState<SaleSlot[]>(() =>
    Array.from({ length: SLOT_COUNT }, () => makeEmptySlot()),
  );
  // Se vuelve true recién en el render que YA refleja los datos cargados
  // (batchea con los setState de abajo). Antes usaba un ref actualizado de
  // forma síncrona, pero eso dejaba correr el efecto de sincronización de
  // abajo en el MISMO flush con el carrito todavía vacío (valor inicial de
  // useState, previo a la carga) -- y como ese efecto siempre escribía en
  // slots[activeSlot] con activeSlot también en su valor inicial (0), cada
  // vez que el POS se volvía a montar (ej. al volver de /ventas/:id tras
  // cobrar) borraba sin querer los datos de la pestaña "Venta 1".
  const [slotsReady, setSlotsReady] = useState(false);

  useEffect(() => {
    setSlotsReady(false);
    if (!slotsKey) {
      setSlots(Array.from({ length: SLOT_COUNT }, () => makeEmptySlot()));
      setActiveSlot(0);
      setCart([]);
      setCustomer("");
      setPointsToRedeem(0);
      setSplitMode(false);
      setSplitPayments([]);
      setSlotsReady(true);
      return;
    }
    try {
      const raw = localStorage.getItem(slotsKey);
      const parsed = raw
        ? (JSON.parse(raw) as { activeSlot: number; slots: SaleSlot[] })
        : null;
      const loadedSlots =
        parsed?.slots?.length === SLOT_COUNT
          ? parsed.slots
          : Array.from({ length: SLOT_COUNT }, () => makeEmptySlot());
      const loadedActive = parsed?.activeSlot ?? 0;
      const normalizedActive =
        loadedActive >= 0 && loadedActive < SLOT_COUNT ? loadedActive : 0;
      const current = loadedSlots[normalizedActive] ?? loadedSlots[0];
      setSlots(loadedSlots);
      setActiveSlot(normalizedActive);
      setCart(current.cart);
      setCustomer(current.customerId);
      setDocType(current.docType as SaleDocumentType);
      setMethod(current.method as PaymentMethod);
      setPointsToRedeem(current.pointsToRedeem);
      setSplitMode(current.splitMode);
      setSplitPayments(current.splitPayments);
    } catch {
      setSlots(Array.from({ length: SLOT_COUNT }, () => makeEmptySlot()));
      setActiveSlot(0);
      setCart([]);
      setCustomer("");
      setPointsToRedeem(0);
      setSplitMode(false);
      setSplitPayments([]);
    } finally {
      setSlotsReady(true);
    }
  }, [slotsKey]);

  // Mantiene la pestaña activa sincronizada con el carrito en tiempo real
  // (para que cambiar de pestaña nunca pierda lo que se acaba de escribir).
  // Solo corre una vez que `slotsReady` es true EN EL MISMO RENDER que ya
  // trae el carrito recién cargado -- así nunca ve un carrito viejo/vacío.
  useEffect(() => {
    if (!slotsReady) return;
    setSlots((current) => {
      const next = [...current];
      next[activeSlot] = {
        cart,
        customerId: customer,
        docType,
        method,
        pointsToRedeem,
        splitMode,
        splitPayments,
      };
      if (slotsKey) {
        try {
          localStorage.setItem(
            slotsKey,
            JSON.stringify({ activeSlot, slots: next }),
          );
        } catch {
          // localStorage lleno o deshabilitado: sigue funcionando en
          // memoria para esta sesión, solo no sobrevive un refresh.
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slotsReady,
    cart,
    customer,
    docType,
    method,
    pointsToRedeem,
    splitMode,
    splitPayments,
    activeSlot,
  ]);

  const switchSlot = (index: number) => {
    if (index === activeSlot || isCheckingOut) return;
    const target = slots[index];
    setActiveSlot(index);
    setCart(target.cart);
    setCustomer(target.customerId);
    if (target.docType) setDocType(target.docType as SaleDocumentType);
    setMethod(target.method as PaymentMethod);
    setPointsToRedeem(target.pointsToRedeem);
    setSplitMode(target.splitMode);
    setSplitPayments(target.splitPayments);
    pendingSaleRef.current = null;
  };

  const slotItemCounts = useMemo(
    () =>
      slots.map((slot) => slot.cart.reduce((sum, item) => sum + item.qty, 0)),
    [slots],
  );

  // Piezas de todos los combos: no dependen de la sucursal (la composición
  // de un combo es la misma en todos lados), solo se usan junto con
  // locationStock para calcular cuántos se pueden armar en la sucursal activa.
  useEffect(() => {
    if (!session?.companyId) return;
    let active = true;
    void fetchAllComboItems(session.companyId)
      .then((data) => {
        if (active) setComboItems(data);
      })
      .catch(() => {
        /* si falla, los combos simplemente se muestran sin stock disponible */
      });
    return () => {
      active = false;
    };
  }, [session?.companyId]);

  // Cuántos combos se pueden armar con el stock actual de sus piezas en la
  // sucursal activa -- el mínimo entre todas las piezas (la más escasa manda).
  const comboAvailability = useMemo(() => {
    const byCombo = new Map<string, ComboItemRow[]>();
    for (const item of comboItems) {
      const list = byCombo.get(item.comboProductId) ?? [];
      list.push(item);
      byCombo.set(item.comboProductId, list);
    }
    const map = new Map<string, number>();
    for (const [comboId, items] of byCombo) {
      if (!locationStock || items.length === 0) {
        map.set(comboId, 0);
        continue;
      }
      let available = Infinity;
      for (const item of items) {
        const componentStock = locationStock.get(item.componentProductId) ?? 0;
        available = Math.min(available, Math.floor(componentStock / item.qty));
      }
      map.set(comboId, Number.isFinite(available) ? Math.max(available, 0) : 0);
    }
    return map;
  }, [comboItems, locationStock]);

  // Productos disponibles en el local activo, con el stock de ese local. Si el
  // stock del local aún no carga, muestra el catálogo completo como respaldo.
  // Combo/Servicio nunca tienen fila propia en product_locations (no manejan
  // stock propio), así que el filtro normal los excluiría por completo --
  // se calculan aparte: Combo usa comboAvailability (mínimo de sus piezas en
  // esta sucursal), Servicio siempre está "disponible" (SERVICE_STOCK_SENTINEL).
  const locatedProducts = useMemo(() => {
    if (!locationStock) return products;
    return products
      .filter((product) => {
        if (
          product.productType === "combo" ||
          product.productType === "service"
        )
          return true;
        return product.hasVariants
          ? variantStockByProduct.has(product.id)
          : locationStock.has(product.id);
      })
      .map((product) => {
        if (product.productType === "combo") {
          return { ...product, stock: comboAvailability.get(product.id) ?? 0 };
        }
        if (product.productType === "service") {
          return { ...product, stock: SERVICE_STOCK_SENTINEL };
        }
        return {
          ...product,
          stock: product.hasVariants
            ? (variantStockByProduct.get(product.id) ?? 0)
            : (locationStock.get(product.id) ?? 0),
        };
      });
  }, [products, locationStock, variantStockByProduct, comboAvailability]);

  const productById = useMemo(
    () => new Map(locatedProducts.map((product) => [product.id, product])),
    [locatedProducts],
  );

  // Promociones automáticas por cantidad: solo para mostrar un aviso ("ya
  // calificas") mientras se arma el carrito -- el descuento real siempre lo
  // calcula y valida create_sale server-side, esto es solo una vista previa.
  useEffect(() => {
    if (!session?.companyId) return;
    let active = true;
    void fetchPromotions(session.companyId)
      .then((data) => {
        if (active) setPromotions(data);
      })
      .catch(() => {
        /* aviso opcional -- si falla, simplemente no se muestra */
      });
    return () => {
      active = false;
    };
  }, [session?.companyId]);

  const qualifyingPromotions = useMemo(() => {
    if (!promotions.length || !cart.length) return [];
    const now = new Date();
    const qtyByProduct = new Map<string, number>();
    const qtyByCategory = new Map<string, number>();
    for (const item of cart) {
      qtyByProduct.set(
        item.productId,
        (qtyByProduct.get(item.productId) ?? 0) + item.qty,
      );
      const categoryId = productById.get(item.productId)?.categoryId;
      if (categoryId) {
        qtyByCategory.set(
          categoryId,
          (qtyByCategory.get(categoryId) ?? 0) + item.qty,
        );
      }
    }
    return promotions.filter((promo) => {
      if (
        promo.type !== "discount" ||
        promo.scopeType === "none" ||
        !promo.active
      )
        return false;
      if (promo.startsAt && new Date(promo.startsAt) > now) return false;
      if (promo.endsAt && new Date(promo.endsAt) < now) return false;
      const minQty = promo.minQty ?? 0;
      if (promo.scopeType === "product" && promo.productId) {
        return (qtyByProduct.get(promo.productId) ?? 0) >= minQty;
      }
      if (promo.scopeType === "category" && promo.categoryId) {
        return (qtyByCategory.get(promo.categoryId) ?? 0) >= minQty;
      }
      return false;
    });
  }, [promotions, cart, productById]);

  // Diferimos búsqueda y categoría: el menú/buscador responden al instante y la
  // grilla se recalcula sin bloquear la UI (cambiar de categoría se siente fluido).
  const deferredQuery = useDeferredValue(query);
  const deferredCategory = useDeferredValue(category);
  const filteredProducts = useMemo(
    () =>
      locatedProducts.filter(
        (product) =>
          (deferredCategory === "all" ||
            product.category === deferredCategory) &&
          (product.name.toLowerCase().includes(deferredQuery.toLowerCase()) ||
            product.barcode.includes(deferredQuery) ||
            (product.sku?.toLowerCase().includes(deferredQuery.toLowerCase()) ??
              false)),
      ),
    [locatedProducts, deferredQuery, deferredCategory],
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(locatedProducts.map((product) => product.category)),
      ).sort(),
    [locatedProducts],
  );

  const openVariantPicker = (product: Product) => {
    setPendingProduct(product);
    setPendingVariants([]);
    setVariantLoading(true);
    void fetchProductVariants(product.id)
      .then(setPendingVariants)
      .catch(() => toast.error("No se pudieron cargar las variantes."))
      .finally(() => setVariantLoading(false));
  };

  const addVariantToCart = (variant: ProductVariant, productArg?: Product) => {
    const product = productArg ?? pendingProduct;
    if (!product) return;
    const stock = variantStockByVariant.get(variant.id) ?? 0;
    if (stock <= 0) {
      toast.error("Esta variante no tiene stock disponible.");
      return;
    }
    const existing = cart.find(
      (item) => item.productId === product.id && item.variantId === variant.id,
    );
    if (existing && existing.qty >= stock) {
      toast.error("No hay más stock de esta variante.");
      return;
    }
    const price =
      variant.priceOverride != null ? variant.priceOverride : product.price;
    setCart((currentCart) => {
      const item = currentCart.find(
        (entry) =>
          entry.productId === product.id && entry.variantId === variant.id,
      );
      if (item) {
        if (item.qty >= stock) return currentCart; // tope de stock (evita sobrepasar)
        return currentCart.map((entry) =>
          entry.productId === product.id && entry.variantId === variant.id
            ? { ...entry, qty: entry.qty + 1 }
            : entry,
        );
      }
      return [
        ...currentCart,
        {
          productId: product.id,
          name: product.name,
          qty: 1,
          price,
          priceIncludesTax: product.priceIncludesTax,
          image: getProductImage(product) ?? undefined,
          barcode: variant.barcode ?? product.barcode,
          variantId: variant.id,
          variantLabel: variant.label,
        },
      ];
    });
    toast.success(`${product.name} (${variant.label}) agregado al carrito`, {
      duration: 1500,
    });
    setPendingProduct(null);
    refocusScanner();
  };

  const addProduct = (product: Product) => {
    if (product.hasVariants) {
      openVariantPicker(product);
      return;
    }
    if (product.stock === 0) {
      toast.error("Este producto no tiene stock disponible.");
      return;
    }

    const existingItem = cart.find(
      (item) => item.productId === product.id && !item.variantId,
    );
    if (existingItem && existingItem.qty >= product.stock) {
      toast.error("No hay más stock disponible para este producto.");
      return;
    }

    setCart((currentCart) => {
      const item = currentCart.find((entry) => entry.productId === product.id);
      if (item) {
        if (item.qty >= product.stock) return currentCart; // tope de stock (evita sobrepasar)
        return currentCart.map((entry) =>
          entry.productId === product.id
            ? { ...entry, qty: entry.qty + 1 }
            : entry,
        );
      }
      return [
        ...currentCart,
        {
          productId: product.id,
          name: product.name,
          qty: 1,
          price: product.price,
          priceIncludesTax: product.priceIncludesTax,
          image: getProductImage(product) ?? undefined,
          barcode: product.barcode,
        },
      ];
    });

    toast.success(`${product.name} agregado al carrito`, { duration: 1500 });
    refocusScanner();
  };

  // Barcode scanner support: scanners type the code and press Enter. On Enter we
  // add the matching product to the cart and clear the box, ready for the next scan.
  const handleScan = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const exact = locatedProducts.find(
      (product) => product.barcode && product.barcode === code,
    );
    if (exact) {
      addProduct(exact);
      setQuery("");
      return;
    }
    // ¿Es el código de barras de una variante? La agrega directo (sin abrir el selector).
    const variantHit = variantBarcodeIndex.get(code);
    if (variantHit) {
      addVariantToCart(variantHit.variant, variantHit.product);
      setQuery("");
      return;
    }
    const product = filteredProducts.length === 1 ? filteredProducts[0] : null;
    if (product) {
      addProduct(product);
      setQuery("");
      return;
    }
    // Nothing matched the scanned code; if there are several matches (manual
    // typing), leave the search so the cashier can pick from the list.
    if (filteredProducts.length === 0) {
      toast.error("No se encontró un producto con ese código.");
      setQuery("");
    }
  };

  // Identificador único de línea del carrito: un producto sin variante usa su id;
  // con variante, producto+variante (así dos variantes del mismo producto son
  // líneas distintas).
  const lineKey = (item: CartItem) =>
    item.variantId ? `${item.productId}::${item.variantId}` : item.productId;

  const increment = (lineId: string) => {
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (lineKey(item) !== lineId) return item;
        const stock = item.variantId
          ? (variantStockByVariant.get(item.variantId) ?? item.qty)
          : (productById.get(item.productId)?.stock ?? item.qty);
        if (item.qty >= stock) {
          toast.error("No hay más stock disponible.");
          return item;
        }
        return { ...item, qty: item.qty + 1 };
      }),
    );
  };

  const decrement = (lineId: string) => {
    setCart((currentCart) =>
      currentCart.flatMap((item) =>
        lineKey(item) === lineId
          ? item.qty <= 1
            ? []
            : [{ ...item, qty: item.qty - 1 }]
          : [item],
      ),
    );
  };

  // Capturar la cantidad a mano (ej. 100 copias) sin dar +1 cien veces.
  const setQty = (lineId: string, qty: number) => {
    if (!Number.isFinite(qty) || qty <= 0) return;
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (lineKey(item) !== lineId) return item;
        const stock = item.variantId
          ? (variantStockByVariant.get(item.variantId) ?? qty)
          : (productById.get(item.productId)?.stock ?? qty);
        if (qty > stock) {
          toast.error(`Solo hay ${stock} en stock.`);
          return { ...item, qty: stock };
        }
        return { ...item, qty: Math.floor(qty) };
      }),
    );
  };

  const remove = (lineId: string) => {
    setCart((currentCart) =>
      currentCart.filter((item) => lineKey(item) !== lineId),
    );
  };

  const handleCreateCustomer = async (input: {
    name: string;
    documentNumber?: string;
    phone?: string;
    address?: string;
  }) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    try {
      const newId = await createCustomer(session, input);
      await reload();
      if (newId) setCustomer(newId);
      toast.success(`Cliente "${input.name}" creado y seleccionado.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo crear el cliente."));
    }
  };

  // IVA line-by-line: respects whether the comprobante charges IVA and whether
  // each product price already includes it. Mirrors the create_sale RPC.
  const { total, subtotal, igv } = useMemo(() => {
    const charges =
      documentTypes.find((d) => d.name === docType)?.chargesIva ?? true;
    const rate = settings.taxRate;
    let runningTotal = 0;
    let runningTax = 0;
    for (const item of cart) {
      const line = Math.round(item.qty * item.price * 100) / 100;
      if (!charges) {
        runningTotal += line;
      } else if (item.priceIncludesTax !== false) {
        runningTotal += line;
        runningTax += Math.round((line - line / (1 + rate)) * 100) / 100;
      } else {
        const lineTax = Math.round(line * rate * 100) / 100;
        runningTotal += line + lineTax;
        runningTax += lineTax;
      }
    }
    return {
      total: runningTotal,
      igv: runningTax,
      subtotal: Math.round((runningTotal - runningTax) * 100) / 100,
    };
  }, [cart, docType, documentTypes, settings.taxRate]);

  const selectedCustomer = customers.find((entry) => entry.id === customer);
  const loyaltyEnabled = !!settings.loyaltyEnabled;
  const maxRedeemablePoints =
    loyaltyEnabled && selectedCustomer && settings.loyaltyPointValue > 0
      ? Math.max(
          0,
          Math.floor(
            Math.min(
              selectedCustomer.loyaltyPoints ?? 0,
              total / settings.loyaltyPointValue,
            ),
          ),
        )
      : 0;
  const loyaltyDiscount =
    Math.round(pointsToRedeem * settings.loyaltyPointValue * 100) / 100;

  // El cliente/carrito cambió: el tope de canje pudo bajar (o desaparecer);
  // nunca dejar pointsToRedeem por encima del nuevo máximo.
  useEffect(() => {
    setPointsToRedeem((current) => Math.min(current, maxRedeemablePoints));
  }, [maxRedeemablePoints]);

  // "Crédito" solo aparece como método de pago si el cliente elegido tiene
  // un límite asignado -- el servidor revalida el disponible real de
  // cualquier forma, esto es solo para no ofrecer la opción quien no
  // califica. El monto exacto disponible siempre lo topa/rechaza create_sale.
  const customerCreditAvailable = selectedCustomer
    ? Math.max(
        0,
        (selectedCustomer.creditLimit ?? 0) -
          (selectedCustomer.creditBalance ?? 0),
      )
    : 0;
  const paymentMethodsWithCredit = useMemo(() => {
    if (!selectedCustomer || (selectedCustomer.creditLimit ?? 0) <= 0) {
      return activeMethods;
    }
    return [
      ...activeMethods,
      {
        id: "credit",
        label: "Crédito",
        kind: "credit" as const,
        description: `Disponible: ${formatMoney(customerCreditAvailable)}`,
      },
    ];
  }, [activeMethods, selectedCustomer, customerCreditAvailable, formatMoney]);

  useEffect(() => {
    if (!paymentMethodsWithCredit.length) return;
    if (
      !paymentMethodsWithCredit.some(
        (paymentMethod) => paymentMethod.label === method,
      )
    ) {
      setMethod(paymentMethodsWithCredit[0].label);
    }
  }, [paymentMethodsWithCredit, method]);

  const checkout = async () => {
    if (cart.length === 0) {
      toast.error("El carrito está vacío.");
      return;
    }

    if (hasOpenCashSession === false) {
      toast.error("Abre la caja de esta sucursal antes de cobrar.");
      return;
    }

    if (isDemo) {
      blockDemoAction();
      return;
    }

    const splitAssigned =
      Math.round(splitPayments.reduce((sum, p) => sum + p.amount, 0) * 100) /
      100;
    if (
      splitMode &&
      (splitPayments.length === 0 ||
        splitAssigned !==
          Math.round(Math.max(0, total - loyaltyDiscount) * 100) / 100)
    ) {
      toast.error("El pago dividido debe sumar exacto al total.");
      return;
    }

    const validCustomerNow = customers.some((entry) => entry.id === customer);
    const usesCredit = splitMode
      ? splitPayments.some((p) => p.kind === "credit")
      : paymentMethodsWithCredit.find((m) => m.label === method)?.kind ===
        "credit";
    if (usesCredit && !validCustomerNow) {
      toast.error(
        "Elige un cliente con crédito habilitado para vender a crédito.",
      );
      return;
    }

    setIsCheckingOut(true);

    // Reutiliza la misma clave si es el mismo carrito de un intento anterior
    // (reintento tras error de red); genera una nueva si el carrito cambió.
    const signature = cartSignature(cart);
    if (pendingSaleRef.current?.signature !== signature) {
      pendingSaleRef.current = { key: crypto.randomUUID(), signature };
    }
    const clientRequestId = pendingSaleRef.current.key;

    try {
      const validCustomer = customers.some((entry) => entry.id === customer);
      const sale = await createSaleFromCart({
        customerId: validCustomer ? customer : null,
        documentType: docType,
        paymentMethod: method,
        paymentKind: paymentMethodsWithCredit.find((m) => m.label === method)
          ?.kind,
        items: cart,
        companyId: session?.companyId,
        locationId: posLocationId,
        clientRequestId,
        pointsRedeemed: validCustomer ? pointsToRedeem : 0,
        payments: splitMode ? splitPayments : undefined,
      });
      const saleId = sale?.id ?? "reciente";
      const amount = sale?.total ?? Math.max(0, total - loyaltyDiscount);
      pendingSaleRef.current = null;
      setCart([]);
      setPointsToRedeem(0);
      setSplitMode(false);
      setSplitPayments([]);
      await reload();
      await reloadLocationStock();
      setSuccess({ amount, id: saleId });
      if (sale?.promoDiscount && sale.promoDiscount > 0) {
        toast.success(
          `Promoción aplicada: ahorraste ${formatMoney(sale.promoDiscount)}.`,
        );
      }
      setTimeout(() => {
        navigate({
          to: "/ventas/$id",
          params: { id: saleId },
          search: { from: "pos" },
        });
      }, 1700);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar la venta."));
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Atajos de teclado del punto de venta (F4/F6/F9/F10). En Mac, estas
  // teclas están tomadas de fábrica por brillo/multimedia/volumen -- hay
  // que mantener presionada "fn" al usarlas, o activar en Ajustes del
  // Sistema → Teclado → "Usar F1, F2, etc. como teclas de función estándar".
  // F12 se evitó a propósito para "Cobrar" porque es el atajo de Chrome/
  // Firefox para abrir las Herramientas de Desarrollador -- se usa F4, que
  // no tiene ningún atajo reservado en los navegadores.
  //
  // El handler se registra UNA sola vez (efecto con deps vacías) y lee todo
  // lo que necesita de este ref, que se actualiza en cada render -- así
  // nunca queda "atrapado" con un carrito o pestaña vieja de cuando se
  // registró el listener por primera vez.
  const shortcutsRef = useRef({
    switchSlot,
    checkout,
    activeSlot,
    isCheckingOut,
  });
  shortcutsRef.current = {
    switchSlot,
    checkout,
    activeSlot,
    isCheckingOut,
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const h = shortcutsRef.current;
      switch (event.key) {
        case "F10":
          event.preventDefault();
          setProductSearchOpen(true);
          break;
        case "F6":
          event.preventDefault();
          h.switchSlot((h.activeSlot + 1) % SLOT_COUNT);
          break;
        case "F4":
          event.preventDefault();
          if (!h.isCheckingOut) void h.checkout();
          break;
        case "F9":
          event.preventDefault();
          setPriceCheckOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const cartProps = {
    cart,
    customers,
    customer,
    docType,
    documentTypes,
    method,
    paymentMethods: paymentMethodsWithCredit,
    subtotal,
    igv,
    total,
    isCheckingOut,
    onCustomerChange: setCustomer,
    onDocTypeChange: setDocType,
    onMethodChange: setMethod,
    onIncrement: (lineId: string) => {
      increment(lineId);
      refocusScanner();
    },
    onDecrement: (lineId: string) => {
      decrement(lineId);
      refocusScanner();
    },
    onSetQty: (lineId: string, qty: number) => {
      setQty(lineId, qty);
      refocusScanner();
    },
    onRemove: remove,
    onCheckout: checkout,
    onCreateCustomer: handleCreateCustomer,
    loyaltyEnabled,
    pointsToRedeem,
    loyaltyDiscount,
    maxRedeemablePoints,
    onPointsToRedeemChange: setPointsToRedeem,
    qualifyingPromotions,
    splitMode,
    onSplitModeChange: setSplitMode,
    splitPayments,
    onSplitPaymentsChange: setSplitPayments,
    slotCount: SLOT_COUNT,
    activeSlot,
    slotItemCounts,
    onSwitchSlot: switchSlot,
  };

  // Sin sucursal concreta (admin con "Todas las tiendas") no se puede vender:
  // se pide elegir una en el selector de arriba.
  if (!posLocationId) {
    return (
      <AppShell>
        <div className="grid min-h-[60vh] place-items-center px-4">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Store className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-bold">Elige una sucursal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Selecciona la sucursal en el menú de arriba para empezar a vender.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (posLocationInactive) {
    return (
      <AppShell>
        <div className="grid min-h-[60vh] place-items-center px-4">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Store className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-bold">Sucursal no disponible</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu sucursal asignada está desactivada. Pide a un administrador que
              te asigne una sucursal activa para poder vender.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Sin caja abierta en esta sucursal, no se puede vender -- primero hay
  // que abrirla en /caja. null (todavía cargando) no bloquea, para no
  // parpadear la pantalla completa mientras se confirma.
  if (hasOpenCashSession === false) {
    return (
      <AppShell>
        <div className="grid min-h-[60vh] place-items-center px-4">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Wallet className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-bold">Abre la caja primero</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No hay una caja abierta en esta sucursal. Ábrela para poder
              empezar a vender.
            </p>
            <Link to="/caja" className="mt-4 inline-block">
              <Button variant="brand">
                <Wallet className="h-4 w-4" /> Ir a Caja
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {error && source === "demo-fallback" && (
        <div className="mb-4 rounded-2xl border border-warm/30 bg-warm/10 px-3.5 py-2.5 text-sm text-foreground">
          No se pudo leer Supabase todavía. Mostrando catálogo de prueba.
        </div>
      )}
      <div className="grid gap-4 pb-24 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:pb-0">
        <ProductCatalog
          products={filteredProducts}
          categories={categories}
          query={query}
          category={category}
          isLoading={isLoading}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onAddProduct={addProduct}
          onScan={handleScan}
          inputRef={scanInputRef}
        />
        <SaleCart
          className="hidden lg:sticky lg:top-0 lg:flex lg:max-h-[calc(100dvh-6.5rem)] lg:flex-col lg:self-start"
          {...cartProps}
        />
        <MobileSaleCart {...cartProps} />
      </div>
      <VariantSelectorDialog
        product={pendingProduct}
        variants={pendingVariants}
        loading={variantLoading}
        variantStock={variantStockByVariant}
        onSelect={addVariantToCart}
        onClose={() => setPendingProduct(null)}
      />
      <SuccessOverlay
        open={!!success}
        title="¡Venta registrada!"
        subtitle={
          success
            ? `Cobro de ${formatMoney(success.amount)} completado`
            : undefined
        }
      />
      <PriceCheckDialog
        open={priceCheckOpen}
        onOpenChange={setPriceCheckOpen}
        products={locatedProducts}
      />
      <ProductSearchDialog
        open={productSearchOpen}
        onOpenChange={setProductSearchOpen}
        products={locatedProducts}
        onSelect={(product) => {
          addProduct(product);
          setProductSearchOpen(false);
        }}
      />
    </AppShell>
  );
}
