import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { MobileSaleCart, SaleCart } from "@/components/pos/SaleCart";
import { ProductCatalog } from "@/components/pos/ProductCatalog";
import { VariantSelectorDialog } from "@/components/pos/VariantSelectorDialog";
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
  fetchLocationStock,
  fetchLocationVariantStock,
  fetchProductVariants,
  fetchPromotions,
  getErrorMessage,
  type Promotion,
  type SalePaymentLine,
} from "@/services/appData";
import type { CartItem, Product, ProductVariant, Sale } from "@/types";

export const Route = createFileRoute("/pos")({ component: POS });

type SaleDocumentType = Sale["type"];
type PaymentMethod = Sale["method"];

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

  useEffect(() => {
    if (!activeMethods.length) return;
    if (
      !activeMethods.some((paymentMethod) => paymentMethod.label === method)
    ) {
      setMethod(activeMethods[0].label);
    }
  }, [activeMethods, method]);

  // Default the comprobante to the first one the store has configured.
  useEffect(() => {
    if (!docType && documentTypes.length) setDocType(documentTypes[0].name);
  }, [docType, documentTypes]);

  // Productos disponibles en el local activo, con el stock de ese local. Si el
  // stock del local aún no carga, muestra el catálogo completo como respaldo.
  const locatedProducts = useMemo(() => {
    if (!locationStock) return products;
    return products
      .filter((product) =>
        product.hasVariants
          ? variantStockByProduct.has(product.id)
          : locationStock.has(product.id),
      )
      .map((product) => ({
        ...product,
        stock: product.hasVariants
          ? (variantStockByProduct.get(product.id) ?? 0)
          : (locationStock.get(product.id) ?? 0),
      }));
  }, [products, locationStock, variantStockByProduct]);

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

  const checkout = async () => {
    if (cart.length === 0) {
      toast.error("El carrito está vacío.");
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
        navigate({ to: "/ventas/$id", params: { id: saleId } });
      }, 1700);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar la venta."));
    } finally {
      setIsCheckingOut(false);
    }
  };

  const cartProps = {
    cart,
    customers,
    customer,
    docType,
    documentTypes,
    method,
    paymentMethods: activeMethods,
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
    </AppShell>
  );
}
