import { useRef, useState, type ReactNode } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/services/appData";

interface LogoUploaderProps {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  fallback?: ReactNode;
  /** px size of the stored square image. */
  size?: number;
  hint?: string;
}

// Resize + center-crop an image file to a small square and return a data URL.
function resizeToDataUrl(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagen no válida."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo procesar la imagen."));
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function LogoUploader({
  value,
  onChange,
  disabled,
  fallback,
  size = 256,
  hint = "PNG o JPG, se recorta en cuadrado.",
}: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona un archivo de imagen.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("La imagen es muy grande (máx. 8 MB).");
      return;
    }
    setBusy(true);
    try {
      onChange(await resizeToDataUrl(file, size));
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo procesar la imagen."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border/70 bg-muted/40",
        )}
      >
        {value ? (
          <img src={value} alt="Logo" className="h-full w-full object-cover" />
        ) : (
          (fallback ?? <ImageIcon className="h-7 w-7 text-muted-foreground" />)
        )}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            {busy ? "Procesando..." : value ? "Cambiar foto" : "Subir foto"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={disabled || busy}
              onClick={() => onChange(null)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Quitar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}
