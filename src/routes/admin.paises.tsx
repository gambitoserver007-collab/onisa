import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMarketByCountryCode } from "@/data/markets";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  fetchCountrySettings,
  updateCountrySetting,
  type CountrySetting,
  getErrorMessage,
} from "@/services/appData";
import type { DocumentType } from "@/types";

export const Route = createFileRoute("/admin/paises")({ component: Paises });

function countryName(code: string) {
  return getMarketByCountryCode(code).countryName;
}

function Paises() {
  const { isDemo } = useDemoSession();
  const [countries, setCountries] = useState<CountrySetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [editing, setEditing] = useState<CountrySetting | null>(null);
  const [taxRatePct, setTaxRatePct] = useState("");
  const [taxName, setTaxName] = useState("");
  const [fiscalIdLabel, setFiscalIdLabel] = useState("");
  const [docs, setDocs] = useState<DocumentType[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const load = () =>
    fetchCountrySettings()
      .then(setCountries)
      .catch((error) => toast.error(getErrorMessage(error, "No se pudieron cargar los países.")))
      .finally(() => setIsLoading(false));

  useEffect(() => {
    void load();
  }, []);

  const openEdit = (country: CountrySetting) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setEditing(country);
    setTaxRatePct(String(Math.round(country.taxRate * 10000) / 100));
    setTaxName(country.taxName);
    setFiscalIdLabel(country.fiscalIdLabel);
    setDocs(country.documentTypes.map((doc) => ({ ...doc })));
  };

  const addDoc = () => setDocs((prev) => [...prev, { name: "", chargesIva: true }]);
  const patchDoc = (index: number, patch: Partial<DocumentType>) =>
    setDocs((prev) => prev.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)));
  const removeDoc = (index: number) => setDocs((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (!editing) return;
    if (isDemo) {
      blockDemoAction();
      return;
    }
    const rate = Number(taxRatePct) / 100;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      toast.error("Ingresa un % de IVA válido (entre 0 y 100).");
      return;
    }
    setIsSaving(true);
    try {
      await updateCountrySetting(editing.countryCode, {
        taxRate: rate,
        taxName,
        fiscalIdLabel,
        documentTypes: docs,
      });
      toast.success("Configuración guardada. Se aplicó a todas las tiendas del país.");
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar la configuración."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Administración"
        icon={Globe}
        title="Países / Impuestos"
        description="El IVA y los comprobantes se configuran por país y aplican a todas las tiendas de ese país."
      />
      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>País</TableHead>
                  <TableHead>Impuesto</TableHead>
                  <TableHead className="text-right">% IVA</TableHead>
                  <TableHead>ID fiscal</TableHead>
                  <TableHead>Comprobantes</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Cargando países...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && countries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        title="Sin países configurados"
                        description="Aplica la migración de configuración por país."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  countries.map((country) => (
                    <TableRow key={country.countryCode}>
                      <TableCell className="font-medium">
                        {countryName(country.countryCode)}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({country.countryCode})
                        </span>
                      </TableCell>
                      <TableCell>{country.taxName}</TableCell>
                      <TableCell className="text-right">
                        {(country.taxRate * 100).toFixed(2)}%
                      </TableCell>
                      <TableCell>{country.fiscalIdLabel}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="flex flex-wrap gap-1">
                          {country.documentTypes.map((doc) => (
                            <Badge key={doc.name} variant={doc.chargesIva ? "success" : "outline"}>
                              {doc.name}
                              {doc.chargesIva ? "" : " · sin IVA"}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Editar ${countryName(country.countryCode)}`}
                          onClick={() => openEdit(country)}
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

      <Dialog open={!!editing} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? countryName(editing.countryCode) : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>% IVA</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRatePct}
                  onChange={(event) => setTaxRatePct(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Nombre del impuesto</Label>
                <Input value={taxName} onChange={(event) => setTaxName(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Nombre del ID fiscal (RUC, RUT, NIT…)</Label>
              <Input
                value={fiscalIdLabel}
                onChange={(event) => setFiscalIdLabel(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Comprobantes</Label>
                <Button type="button" size="sm" variant="outline" onClick={addDoc}>
                  <Plus className="mr-1 h-3 w-3" /> Agregar
                </Button>
              </div>
              {docs.length === 0 && (
                <p className="text-xs text-muted-foreground">Agrega al menos un comprobante.</p>
              )}
              {docs.map((doc, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border p-2">
                  <Input
                    className="flex-1"
                    placeholder="Ej. Factura"
                    value={doc.name}
                    onChange={(event) => patchDoc(index, { name: event.target.value })}
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Cobra IVA</span>
                    <Switch
                      checked={doc.chargesIva}
                      onCheckedChange={(checked) => patchDoc(index, { chargesIva: checked })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label="Quitar comprobante"
                    onClick={() => removeDoc(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="brand" disabled={isSaving} onClick={handleSave}>
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
