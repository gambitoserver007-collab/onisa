import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Receipt, Store, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import { refreshLocations } from "@/lib/currentLocation";
import {
  createLocation,
  createTill,
  fetchLocations,
  fetchTills,
  setLocationActive,
  setTillActive,
  updateLocation,
  updateLocationTicketSettings,
  updateTill,
  type Location,
  type Till,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/puntos-de-venta")({
  component: PuntosDeVenta,
});

// El horario se guarda como "HH:MM - HH:MM" en la columna opening_hours.
function buildHours(open: string, close: string) {
  if (open && close) return `${open} - ${close}`;
  return open || close || "";
}
function parseHours(value: string | null) {
  const isTime = /^\d{1,2}:\d{2}$/;
  const [open = "", close = ""] = (value ?? "")
    .split(" - ")
    .map((part) => part.trim());
  return {
    open: isTime.test(open) ? open : "",
    close: isTime.test(close) ? close : "",
  };
}

function PuntosDeVenta() {
  const { isDemo, session, isReady } = useDemoSession();
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [managerName, setManagerName] = useState("");
  const [openHour, setOpenHour] = useState("");
  const [closeHour, setCloseHour] = useState("");

  // Cajas (tills): catálogo de cajas físicas por sucursal -- Etapa 1 del
  // módulo de arqueo. No afecta apertura/cierre de caja todavía.
  const [tillsFor, setTillsFor] = useState<Location | null>(null);
  const [tillsList, setTillsList] = useState<Till[]>([]);
  const [tillsLoading, setTillsLoading] = useState(false);
  const [editingTill, setEditingTill] = useState<Till | null>(null);
  const [tillName, setTillName] = useState("");
  const [tillCode, setTillCode] = useState("");
  const [tillSaving, setTillSaving] = useState(false);

  // Configuración del ticket impreso, por sucursal.
  const [ticketFor, setTicketFor] = useState<Location | null>(null);
  const [tShowLogo, setTShowLogo] = useState(true);
  const [tShowFiscalInfo, setTShowFiscalInfo] = useState(true);
  const [tShowCashierName, setTShowCashierName] = useState(false);
  const [tFooterText, setTFooterText] = useState("");
  const [tShowTaxBreakdown, setTShowTaxBreakdown] = useState(true);
  const [tShowLoyaltyPoints, setTShowLoyaltyPoints] = useState(true);
  const [tShowPaymentMethod, setTShowPaymentMethod] = useState(true);
  const [ticketSaving, setTicketSaving] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setLocations(await fetchLocations(session?.companyId));
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudieron cargar las sucursales."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  const resetFields = () => {
    setName("");
    setShortCode("");
    setCity("");
    setAddress("");
    setPhone("");
    setManagerName("");
    setOpenHour("");
    setCloseHour("");
  };

  const openNew = () => {
    setEditing(null);
    resetFields();
    setOpen(true);
  };

  const openEdit = (location: Location) => {
    setEditing(location);
    setName(location.name);
    setShortCode(location.shortCode ?? "");
    setCity(location.city ?? "");
    setAddress(location.address ?? "");
    setPhone(location.phone ?? "");
    setManagerName(location.managerName ?? "");
    const hours = parseHours(location.openingHours);
    setOpenHour(hours.open);
    setCloseHour(hours.close);
    setOpen(true);
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    setIsSaving(true);
    try {
      const fields = {
        name,
        shortCode,
        city,
        address,
        phone,
        managerName,
        openingHours: buildHours(openHour, closeHour),
      };
      if (editing) {
        await updateLocation(editing.id, {
          ...fields,
          isActive: editing.isActive,
        });
        toast.success("Sucursal actualizada.");
      } else {
        await createLocation(session, fields);
        toast.success("Sucursal creada.");
      }
      setOpen(false);
      await reload();
      await refreshLocations(); // refresca el selector global + POS/Caja/Inventario
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar la sucursal."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (location: Location, isActive: boolean) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    // No dejar al negocio sin sucursales activas (POS/Caja/Inventario quedarían inutilizables).
    if (!isActive && locations.filter((l) => l.isActive).length <= 1) {
      toast.error("Debe quedar al menos una sucursal activa.");
      return;
    }
    setLocations((current) =>
      current.map((item) =>
        item.id === location.id ? { ...item, isActive } : item,
      ),
    );
    try {
      await setLocationActive(location.id, isActive);
      await refreshLocations(); // refresca el selector global + POS/Caja/Inventario
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar."));
      await reload();
    }
  };

  const reloadTills = async (locationId: string) => {
    setTillsLoading(true);
    try {
      setTillsList(await fetchTills(locationId));
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudieron cargar las cajas."));
    } finally {
      setTillsLoading(false);
    }
  };

  const openTills = (location: Location) => {
    setTillsFor(location);
    setEditingTill(null);
    setTillName("");
    setTillCode("");
    void reloadTills(location.id);
  };

  const openTillEdit = (till: Till) => {
    setEditingTill(till);
    setTillName(till.name);
    setTillCode(till.code ?? "");
  };

  const resetTillForm = () => {
    setEditingTill(null);
    setTillName("");
    setTillCode("");
  };

  const handleTillSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session || !tillsFor) return;
    setTillSaving(true);
    try {
      if (editingTill) {
        await updateTill(editingTill.id, {
          name: tillName,
          code: tillCode,
          isActive: editingTill.isActive,
        });
        toast.success("Caja actualizada.");
      } else {
        await createTill(session, tillsFor.id, {
          name: tillName,
          code: tillCode,
        });
        toast.success("Caja creada.");
      }
      resetTillForm();
      await reloadTills(tillsFor.id);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar la caja."));
    } finally {
      setTillSaving(false);
    }
  };

  const openTicketSettings = (location: Location) => {
    setTicketFor(location);
    setTShowLogo(location.ticketShowLogo);
    setTShowFiscalInfo(location.ticketShowFiscalInfo);
    setTShowCashierName(location.ticketShowCashierName);
    setTFooterText(location.ticketFooterText ?? "");
    setTShowTaxBreakdown(location.ticketShowTaxBreakdown);
    setTShowLoyaltyPoints(location.ticketShowLoyaltyPoints);
    setTShowPaymentMethod(location.ticketShowPaymentMethod);
  };

  const handleTicketSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!ticketFor) return;
    setTicketSaving(true);
    try {
      await updateLocationTicketSettings(ticketFor.id, {
        showLogo: tShowLogo,
        showFiscalInfo: tShowFiscalInfo,
        showCashierName: tShowCashierName,
        footerText: tFooterText,
        showTaxBreakdown: tShowTaxBreakdown,
        showLoyaltyPoints: tShowLoyaltyPoints,
        showPaymentMethod: tShowPaymentMethod,
      });
      toast.success(`Configuración de ticket de ${ticketFor.name} guardada.`);
      setTicketFor(null);
      await reload();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo guardar la configuración."),
      );
    } finally {
      setTicketSaving(false);
    }
  };

  const handleTillToggle = async (till: Till, isActive: boolean) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!tillsFor) return;
    setTillsList((current) =>
      current.map((item) =>
        item.id === till.id ? { ...item, isActive } : item,
      ),
    );
    try {
      await setTillActive(till.id, isActive);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar."));
      await reloadTills(tillsFor.id);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Sucursales"
        description="Tus locales, tiendas o bodegas. Cada una maneja su propio stock y ventas."
        eyebrow="Sistema"
        icon={Store}
        actions={
          <Button variant="brand" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Nueva sucursal
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando sucursales...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && locations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        emoji="🏬"
                        title="Sin sucursales"
                        description="Crea tu primera sucursal (local, tienda o bodega) para empezar."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  locations.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell className="font-medium">
                        {location.shortCode && (
                          <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {location.shortCode}
                          </span>
                        )}
                        {location.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {location.city || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {location.address || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={location.isActive}
                            onCheckedChange={(checked) =>
                              handleToggle(location, checked)
                            }
                          />
                          <Badge
                            variant={location.isActive ? "success" : "warm"}
                          >
                            {location.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Cajas"
                          onClick={() => openTills(location)}
                        >
                          <Wallet className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Configurar ticket"
                          onClick={() => openTicketSettings(location)}
                        >
                          <Receipt className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Editar"
                          onClick={() => openEdit(location)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar sucursal" : "Nueva sucursal"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Tienda Centro, Bodega, Sucursal Norte"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Código corto</Label>
                <Input
                  value={shortCode}
                  onChange={(event) => setShortCode(event.target.value)}
                  placeholder="Ej. T-01"
                  maxLength={12}
                />
              </div>
              <div className="space-y-1">
                <Label>Ciudad</Label>
                <Input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="Ej. Quito"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Dirección</Label>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Calle y número"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Teléfono</Label>
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Ej. 099 123 4567"
                />
              </div>
              <div className="space-y-1">
                <Label>Encargado</Label>
                <Input
                  value={managerName}
                  onChange={(event) => setManagerName(event.target.value)}
                  placeholder="Quién lo administra"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Horario de atención</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">Abre</span>
                  <Input
                    type="time"
                    value={openHour}
                    onChange={(event) => setOpenHour(event.target.value)}
                  />
                </div>
                <span className="pt-5 text-muted-foreground">—</span>
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">Cierra</span>
                  <Input
                    type="time"
                    value={closeHour}
                    onChange={(event) => setCloseHour(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSaving || !name.trim()}
              onClick={handleSave}
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!tillsFor}
        onOpenChange={(open) => !open && setTillsFor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cajas — {tillsFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-2xl border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tillsLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Cargando cajas...
                      </TableCell>
                    </TableRow>
                  )}
                  {!tillsLoading && tillsList.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Sin cajas todavía.
                      </TableCell>
                    </TableRow>
                  )}
                  {tillsList.map((till) => (
                    <TableRow key={till.id}>
                      <TableCell className="font-medium">{till.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {till.code || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={till.isActive}
                            onCheckedChange={(checked) =>
                              handleTillToggle(till, checked)
                            }
                          />
                          <Badge variant={till.isActive ? "success" : "warm"}>
                            {till.isActive ? "Activa" : "Inactiva"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openTillEdit(till)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>
                  Nombre <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={tillName}
                  onChange={(event) => setTillName(event.target.value)}
                  placeholder="Ej. Caja 2"
                />
              </div>
              <div className="space-y-1">
                <Label>Código</Label>
                <Input
                  value={tillCode}
                  onChange={(event) => setTillCode(event.target.value)}
                  placeholder="Ej. CAJA-2"
                  maxLength={12}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            {editingTill && (
              <Button variant="ghost" onClick={resetTillForm}>
                Cancelar edición
              </Button>
            )}
            <Button
              variant="brand"
              disabled={tillSaving || !tillName.trim()}
              onClick={handleTillSave}
            >
              {tillSaving
                ? "Guardando..."
                : editingTill
                  ? "Guardar cambios"
                  : "Agregar caja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!ticketFor}
        onOpenChange={(open) => !open && setTicketFor(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ticket — {ticketFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Datos del negocio
              </p>
              <div className="flex items-center justify-between gap-2">
                <Label className="font-normal">Mostrar logo</Label>
                <Switch checked={tShowLogo} onCheckedChange={setTShowLogo} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="font-normal">
                  Mostrar RFC/ID fiscal, dirección y teléfono
                </Label>
                <Switch
                  checked={tShowFiscalInfo}
                  onCheckedChange={setTShowFiscalInfo}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="font-normal">Mostrar nombre del cajero</Label>
                <Switch
                  checked={tShowCashierName}
                  onCheckedChange={setTShowCashierName}
                />
              </div>
            </div>
            <div className="space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Datos de la venta
              </p>
              <div className="flex items-center justify-between gap-2">
                <Label className="font-normal">
                  Mostrar desglose de IVA/impuesto
                </Label>
                <Switch
                  checked={tShowTaxBreakdown}
                  onCheckedChange={setTShowTaxBreakdown}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="font-normal">Mostrar puntos de lealtad</Label>
                <Switch
                  checked={tShowLoyaltyPoints}
                  onCheckedChange={setTShowLoyaltyPoints}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="font-normal">Mostrar método de pago</Label>
                <Switch
                  checked={tShowPaymentMethod}
                  onCheckedChange={setTShowPaymentMethod}
                />
              </div>
            </div>
            <div className="space-y-1 border-t border-border/60 pt-3">
              <Label>Pie de página</Label>
              <Textarea
                value={tFooterText}
                onChange={(event) => setTFooterText(event.target.value)}
                placeholder="Ej. Gracias por su compra. No se aceptan devoluciones sin ticket."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={ticketSaving}
              onClick={handleTicketSave}
            >
              {ticketSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
