import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCashMovement, getErrorMessage } from "@/services/appData";
import type { DemoSession } from "@/types";

// Entrada/Salida de efectivo (F7/F8) directo desde el POS -- sin salir a
// Caja -- para que el cajero no pierda el carrito que está armando. Usa la
// misma RPC/tabla que el diálogo de "Nuevo movimiento" en /caja.
export interface CashMovementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "ingreso" | "egreso";
  session: DemoSession | null | undefined;
  cashSessionId: string | null;
  onSaved?: () => void;
}

export function CashMovementDialog({
  open,
  onOpenChange,
  type,
  session,
  cashSessionId,
  onSaved,
}: CashMovementDialogProps) {
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setConcept("");
      setAmount("");
    }
  }, [open]);

  const handleSave = async () => {
    if (!session || !cashSessionId) return;
    const magnitude = Number(amount);
    if (!(magnitude > 0)) {
      toast.error("Ingresa un monto válido.");
      return;
    }
    setSaving(true);
    try {
      await createCashMovement(
        session,
        cashSessionId,
        type,
        concept,
        magnitude,
      );
      toast.success(
        type === "ingreso"
          ? "Entrada de efectivo registrada."
          : "Salida de efectivo registrada.",
      );
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo registrar el movimiento."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {type === "ingreso" ? "Entrada de efectivo" : "Salida de efectivo"}
          </DialogTitle>
        </DialogHeader>
        {!cashSessionId ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay una caja abierta en esta sucursal.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Concepto</Label>
              <Input
                autoFocus
                value={concept}
                onChange={(event) => setConcept(event.target.value)}
                placeholder={
                  type === "ingreso"
                    ? "Ej. Fondo adicional"
                    : "Ej. Compra de bolsas"
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Monto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSave();
                }}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="brand"
            disabled={saving || !cashSessionId || !(Number(amount) > 0)}
            onClick={handleSave}
          >
            {saving ? "Guardando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
