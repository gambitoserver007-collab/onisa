import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BadgePercent, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createPromotion,
  deletePromotion,
  fetchPromotions,
  setPromotionActive,
  updatePromotion,
  type Promotion,
  type PromotionType,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/promociones")({ component: Promos });

const TYPE_LABELS: Record<string, string> = {
  discount: "Descuento %",
  "2x1": "2x1",
  combo: "Combo",
};

function Promos() {
  const { formatMoney } = useBusinessSettings();
  const { isDemo, session, isReady } = useDemoSession();
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<PromotionType>("discount");
  const [value, setValue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setPromos(await fetchPromotions(session?.companyId));
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudieron cargar las promociones."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setType("discount");
    setValue("");
    setStartsAt("");
    setEndsAt("");
    setOpen(true);
  };

  const openEdit = (promo: Promotion) => {
    setEditing(promo);
    setName(promo.name);
    setType(promo.type as PromotionType);
    setValue(
      promo.type === "discount"
        ? (promo.valueText ?? "").replace("%", "")
        : promo.type === "combo"
          ? String(promo.valueAmount ?? "")
          : "",
    );
    setStartsAt(promo.startsAt?.slice(0, 10) ?? "");
    setEndsAt(promo.endsAt?.slice(0, 10) ?? "");
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
      const numeric = Number(value);
      const input = {
        name,
        type,
        valueText: type === "discount" ? `${numeric || 0}%` : null,
        valueAmount: type === "combo" ? numeric || 0 : null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
      };
      if (editing) {
        await updatePromotion(editing.id, input);
        toast.success("Promoción actualizada.");
      } else {
        await createPromotion(session, input);
        toast.success("Promoción creada.");
      }
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar la promoción."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (promo: Promotion, active: boolean) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setPromos((current) =>
      current.map((item) =>
        item.id === promo.id ? { ...item, active } : item,
      ),
    );
    try {
      await setPromotionActive(promo.id, active);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar."));
      await reload();
    }
  };

  const handleDelete = async (promo: Promotion) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    try {
      await deletePromotion(promo.id);
      toast.success("Promoción eliminada.");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar."));
    }
  };

  const valueOf = (promo: Promotion) => {
    if (promo.type === "combo") return formatMoney(promo.valueAmount ?? 0);
    if (promo.type === "discount") return promo.valueText ?? "-";
    return "-";
  };

  return (
    <AppShell>
      <PageHeader
        title="Promociones"
        description="Ofertas y combos."
        eyebrow="Marketing"
        icon={BadgePercent}
        actions={
          <Button variant="brand" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nueva promoción
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar promoción" : "Nueva promoción"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. 2x1 de fin de semana"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as PromotionType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount">Descuento %</SelectItem>
                    <SelectItem value="2x1">2x1</SelectItem>
                    <SelectItem value="combo">Combo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  {type === "combo"
                    ? "Precio combo"
                    : type === "discount"
                      ? "Descuento (%)"
                      : "Valor"}
                </Label>
                <Input
                  type="number"
                  value={value}
                  disabled={type === "2x1"}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={type === "2x1" ? "—" : "0"}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Inicio</Label>
                <Input
                  type="date"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Fin</Label>
                <Input
                  type="date"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
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
      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Activa</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando promociones...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && promos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        emoji="🏷️"
                        title="Sin promociones"
                        description="Crea tu primera oferta o combo para la tienda."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  promos.map((promo) => (
                    <TableRow key={promo.id}>
                      <TableCell className="font-medium">
                        {promo.name}
                      </TableCell>
                      <TableCell>
                        {TYPE_LABELS[promo.type] ?? promo.type}
                      </TableCell>
                      <TableCell>{valueOf(promo)}</TableCell>
                      <TableCell>
                        {promo.startsAt?.slice(0, 10) ?? "-"}
                      </TableCell>
                      <TableCell>{promo.endsAt?.slice(0, 10) ?? "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={promo.active}
                            onCheckedChange={(checked) =>
                              handleToggle(promo, checked)
                            }
                          />
                          <Badge variant={promo.active ? "success" : "warm"}>
                            {promo.active ? "Activa" : "Pausada"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(promo)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDelete(promo)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
