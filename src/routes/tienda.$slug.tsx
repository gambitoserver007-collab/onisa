import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageOff, Search, ShoppingBag, Store, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCurrencyAmount } from "@/data/markets";
import {
  fetchPublicCatalog,
  fetchPublicCategories,
  fetchPublicCompanyBySlug,
  submitQuoteRequest,
  getErrorMessage,
  type PublicCatalogProduct,
  type PublicCategory,
  type PublicCompany,
} from "@/services/appData";

export const Route = createFileRoute("/tienda/$slug")({
  component: TiendaPublica,
});

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

interface TurnstileGlobal {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

// Widget de Cloudflare Turnstile -- se carga solo en esta página (nunca en
// el resto de la app), porque es la única con un formulario público sin
// sesión. `onToken("")` se dispara al expirar, para que el botón de enviar
// se vuelva a bloquear hasta que el visitante lo resuelva de nuevo.
function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    let cancelled = false;

    const render = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.onload = render;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;

      if (window.turnstile && widgetIdRef.current)
        window.turnstile.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!TURNSTILE_SITE_KEY) {
    return (
      <p className="text-xs text-destructive">
        Verificación no disponible (falta configurar el sitio).
      </p>
    );
  }

  return <div ref={containerRef} />;
}

interface CartLine {
  product: PublicCatalogProduct;
  qty: number;
}

function TiendaPublica() {
  const { slug } = Route.useParams();

  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");

  useEffect(() => {
    let active = true;
    setCompanyLoading(true);

    void fetchPublicCompanyBySlug(slug)
      .then((result) => {
        if (!active) return;
        setCompany(result);
      })
      .catch(() => {
        if (active) setCompany(null);
      })
      .finally(() => {
        if (active) setCompanyLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!company) return;
    let active = true;

    void fetchPublicCategories(company.id).then((rows) => {
      if (active) setCategories(rows);
    });

    return () => {
      active = false;
    };
  }, [company]);

  useEffect(() => {
    if (!company) return;
    let active = true;
    setProductsLoading(true);

    const timer = setTimeout(() => {
      void fetchPublicCatalog(company.id, {
        categoryId: categoryId === "all" ? undefined : categoryId,
        search,
        pageSize: 60,
      })
        .then((result) => {
          if (active) setProducts(result.products);
        })
        .finally(() => {
          if (active) setProductsLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [company, categoryId, search]);

  const formatMoney = (value: number) =>
    company
      ? formatCurrencyAmount(value, {
          locale: company.locale,
          currencyCode: company.currencyCode,
        })
      : String(value);

  // --- Mi lista (cotización) ---
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [cartOpen, setCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);
  const cartCount = cartLines.reduce((sum, line) => sum + line.qty, 0);

  const addToCart = (product: PublicCatalogProduct) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(product.id);

      next.set(product.id, { product, qty: (existing?.qty ?? 0) + 1 });

      return next;
    });
  };

  const setQty = (productId: string, qty: number) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);

      if (!existing) return prev;

      if (qty <= 0) {
        next.delete(productId);
      } else {
        next.set(productId, { ...existing, qty });
      }

      return next;
    });
  };

  const handleSubmit = async () => {
    if (!company) return;

    if (!customerName.trim()) {
      toast.error("Ingresa tu nombre.");

      return;
    }

    if (!phone.trim() && !email.trim()) {
      toast.error("Ingresa un teléfono o un correo de contacto.");

      return;
    }

    if (!turnstileToken) {
      toast.error("Completa la verificación anti-spam.");

      return;
    }

    setSubmitting(true);

    try {
      await submitQuoteRequest({
        companySlug: slug,
        customerName: customerName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
        items: cartLines.map((line) => ({
          productId: line.product.id,
          qty: line.qty,
        })),
        turnstileToken,
      });
      setSubmitted(true);
      setCart(new Map());
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 text-muted-foreground">
        Cargando catálogo…
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <Store className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">Catálogo no disponible</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Este link no existe o la tienda todavía no activó su catálogo en
          línea.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 pb-24">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Store className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold leading-tight">{company.name}</p>
              <p className="text-xs text-muted-foreground">
                Arma tu lista y pide cotización
              </p>
            </div>
          </div>
          <Button variant="brand" onClick={() => setCartOpen(true)}>
            <ShoppingBag className="mr-2 h-4 w-4" />
            Mi lista {cartCount > 0 ? `(${cartCount})` : ""}
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar producto..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {categories.length > 0 && (
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {productsLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Cargando productos...
          </p>
        )}

        {!productsLoading && products.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No encontramos productos con esa búsqueda.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {products.map((product) => {
            const inCart = cart.get(product.id);

            return (
              <Card key={product.id} className="overflow-hidden">
                <div className="grid aspect-square place-items-center bg-muted/40">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageOff className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <CardContent className="space-y-2 p-3">
                  <p
                    className="line-clamp-2 min-h-[2.5rem] text-sm font-medium"
                    title={product.name}
                  >
                    {product.name}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">
                      {formatMoney(product.price)}
                    </span>
                    {!product.available && (
                      <Badge variant="secondary" className="text-[10px]">
                        Agotado
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={inCart ? "outline" : "brand"}
                    className="w-full"
                    onClick={() => addToCart(product)}
                  >
                    {inCart ? `En tu lista (${inCart.qty})` : "Agregar"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Mi lista de cotización</SheetTitle>
          </SheetHeader>

          {submitted ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <ShoppingBag className="h-10 w-10 text-primary" />
              <p className="font-semibold">¡Listo! Te contactaremos pronto.</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                {company.name} revisará tu lista y te contactará para confirmar
                precios y disponibilidad.
              </p>
              <Button variant="outline" onClick={() => setCartOpen(false)}>
                Seguir viendo el catálogo
              </Button>
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-4 overflow-y-auto py-2">
                {cartLines.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Todavía no agregas productos.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {cartLines.map((line) => (
                      <div
                        key={line.product.id}
                        className="flex items-center gap-2 rounded-lg border p-2"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {line.product.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatMoney(line.product.price)}
                          </p>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          className="w-16 text-right"
                          value={line.qty}
                          onChange={(event) =>
                            setQty(line.product.id, Number(event.target.value))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar ${line.product.name}`}
                          onClick={() => setQty(line.product.id, 0)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {cartLines.length > 0 && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="space-y-1">
                      <Label>Tu nombre</Label>
                      <Input
                        value={customerName}
                        onChange={(event) =>
                          setCustomerName(event.target.value)
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label>Teléfono</Label>
                        <Input
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Correo</Label>
                        <Input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Notas (opcional)</Label>
                      <Textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Colores, marcas, para cuándo lo necesitas..."
                      />
                    </div>
                    <TurnstileWidget onToken={setTurnstileToken} />
                  </div>
                )}
              </div>

              {cartLines.length > 0 && (
                <SheetFooter>
                  <Button
                    variant="brand"
                    className="w-full"
                    disabled={submitting}
                    onClick={() => void handleSubmit()}
                  >
                    {submitting ? "Enviando..." : "Enviar solicitud"}
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
