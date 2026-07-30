import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Database, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { buildBackupExport, getErrorMessage } from "@/services/appData";

export const Route = createFileRoute("/backup")({ component: Backup });

interface BackupFile {
  id: string;
  date: string;
  size: string;
  json: string;
}

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Backup() {
  const { isDemo, session, isReady } = useDemoSession();
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!isReady) return;
    setIsGenerating(true);
    try {
      const data = await buildBackupExport(session?.companyId);
      const json = JSON.stringify(data, null, 2);
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
        now.getDate(),
      ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(
        now.getMinutes(),
      ).padStart(2, "0")}`;
      const id = `BK-${stamp}`;
      const size = humanSize(new Blob([json]).size);
      downloadJson(`${id}.json`, json);
      setBackups((current) => [
        {
          id,
          date: now.toLocaleString("es"),
          size,
          json,
        },
        ...current,
      ]);
      toast.success("Backup generado y descargado.");
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo generar el backup."));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        icon={Database}
        eyebrow="Sistema"
        title="Respaldo"
        description="Descarga un respaldo completo de los datos de tu tienda."
        actions={
          <Button
            variant="brand"
            disabled={isGenerating}
            onClick={handleGenerate}
          >
            <Database className="mr-1 h-4 w-4" />
            {isGenerating ? "Generando..." : "Generar backup"}
          </Button>
        }
      />
      <Card className="shadow-card">
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Archivo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Tamaño</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState
                      emoji="💾"
                      title="Sin respaldos"
                      description="Genera un backup para descargar todos tus datos en un archivo."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                backups.map((backup) => (
                  <TableRow key={backup.id}>
                    <TableCell className="font-mono">{backup.id}</TableCell>
                    <TableCell>{backup.date}</TableCell>
                    <TableCell>{backup.size}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          downloadJson(`${backup.id}.json`, backup.json)
                        }
                      >
                        <Download className="mr-1 h-3 w-3" /> Descargar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() =>
                          setBackups((current) =>
                            current.filter((item) => item.id !== backup.id),
                          )
                        }
                      >
                        <Trash2 className="mr-1 h-3 w-3" /> Eliminar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
