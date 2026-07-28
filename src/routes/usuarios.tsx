import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  GRANTABLE_SECTIONS,
  ROLE_DEFAULT_SECTIONS,
  STORE_ROLE_LABELS,
  type StoreRole,
} from "@/lib/permissions";
import {
  createTeamUser,
  deleteTeamUser,
  fetchPlanUsage,
  fetchTeam,
  updateTeamUser,
  type PlanUsage,
  type TeamMember,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/usuarios")({ component: Usuarios });

const UNLIMITED = 1_000_000;

const ROLE_LABELS = STORE_ROLE_LABELS;

// Secciones agrupadas por bloque del panel, para el bloque de "Accesos".
const SECTION_GROUPS = GRANTABLE_SECTIONS.reduce<{ group: string; items: typeof GRANTABLE_SECTIONS }[]>(
  (acc, section) => {
    const existing = acc.find((g) => g.group === section.group);
    if (existing) existing.items.push(section);
    else acc.push({ group: section.group, items: [section] });
    return acc;
  },
  [],
);

const defaultSectionsFor = (role: StoreRole) => [...ROLE_DEFAULT_SECTIONS[role]];

function Usuarios() {
  const { isDemo, session, isReady } = useDemoSession();
  const { locations } = useCurrentLocation();
  const multiLocal = locations.length > 1;
  const locationNames = (ids: string[]) => {
    if (!ids.length) return "Todas";
    const names = ids
      .map((id) => locations.find((loc) => loc.id === id)?.name)
      .filter((name): name is string => !!name);
    return names.length ? names.join(", ") : "—";
  };
  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StoreRole>("user");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [sectionKeys, setSectionKeys] = useState<string[]>(defaultSectionsFor("user"));
  const [saasPanel, setSaasPanel] = useState(false);

  // Al cambiar el rol, pre-marca los accesos por defecto de ese rol.
  const handleRoleChange = (next: StoreRole) => {
    setRole(next);
    setSectionKeys(defaultSectionsFor(next));
    if (next !== "admin") setSaasPanel(false);
  };

  // Edit / delete state.
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<StoreRole>("user");
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [editLocationIds, setEditLocationIds] = useState<string[]>([]);
  const [editSectionKeys, setEditSectionKeys] = useState<string[]>([]);
  const [editSaasPanel, setEditSaasPanel] = useState(false);

  const handleEditRoleChange = (next: StoreRole) => {
    setEditRole(next);
    setEditSectionKeys(defaultSectionsFor(next));
    if (next !== "admin") setEditSaasPanel(false);
  };
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [deleting, setDeleting] = useState<TeamMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [teamData, usageData] = await Promise.all([
        fetchTeam(session?.companyId),
        fetchPlanUsage(session?.companyId),
      ]);
      setTeam(teamData);
      setUsage(usageData);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo cargar el equipo."));
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId]);

  const userLimit = usage?.plan?.userLimit ?? 0;
  const activeCount = team.filter((t) => t.active).length;
  const atLimit = userLimit > 0 && userLimit < UNLIMITED && activeCount >= userLimit;

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  const handleCreate = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (atLimit) {
      toast.error(
        `Alcanzaste el límite de ${userLimit} ${userLimit === 1 ? "usuario" : "usuarios"} de tu plan. Mejora tu plan para agregar más.`,
      );
      return;
    }
    setIsSaving(true);
    try {
      await createTeamUser(session, {
        fullName,
        email,
        password,
        role,
        locationIds: multiLocal ? locationIds : undefined,
        allowedSections: sectionKeys,
        saasPanel: role === "admin" ? saasPanel : false,
      });
      toast.success("Usuario creado.");
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("user");
      setLocationIds([]);
      setSectionKeys(defaultSectionsFor("user"));
      setSaasPanel(false);
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo crear el usuario."));
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (member: TeamMember) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    const memberRole = (member.role as StoreRole) ?? "user";
    setEditing(member);
    setEditName(member.name);
    setEditRole(memberRole);
    setEditActive(member.active);
    setEditPassword("");
    setEditLocationIds(member.locationIds ?? []);
    // Accesos guardados; si no tiene lista propia, usa los defaults del rol.
    setEditSectionKeys(
      member.allowedSections && member.allowedSections.length > 0
        ? member.allowedSections
        : defaultSectionsFor(memberRole),
    );
    setEditSaasPanel(member.isPlatformAdmin);
  };

  const handleUpdate = async () => {
    if (!session || !editing) return;
    setIsEditSaving(true);
    try {
      await updateTeamUser(session, {
        userId: editing.id,
        fullName: editName,
        role: editRole,
        isActive: editActive,
        password: editPassword,
        locationIds: multiLocal ? editLocationIds : undefined,
        allowedSections: editSectionKeys,
        saasPanel: editRole === "admin" ? editSaasPanel : false,
      });
      toast.success("Usuario actualizado.");
      setEditing(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar el usuario."));
    } finally {
      setIsEditSaving(false);
    }
  };

  const askDelete = (member: TeamMember) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setDeleting(member);
  };

  const handleDelete = async () => {
    if (!session || !deleting) return;
    setIsDeleting(true);
    try {
      await deleteTeamUser(session, deleting.id);
      toast.success("Usuario eliminado.");
      setDeleting(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el usuario."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        icon={Shield}
        eyebrow="Equipo"
        title="Usuarios"
        description={
          userLimit > 0 && userLimit < UNLIMITED
            ? `Gestiona los accesos del equipo · ${activeCount} de ${userLimit} usuarios activos del plan.`
            : "Gestiona los accesos del equipo."
        }
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand" disabled={atLimit}>
                <Plus className="mr-1 h-4 w-4" /> Nuevo usuario
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nuevo usuario</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Nombre</Label>
                  <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Correo</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Contraseña</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Rol</Label>
                  <Select value={role} onValueChange={(v) => handleRoleChange(v as StoreRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Cajero</SelectItem>
                      <SelectItem value="operador">Operador</SelectItem>
                      <SelectItem value="finanzas">Finanzas</SelectItem>
                      <SelectItem value="admin">Administrador de tienda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {multiLocal && (
                  <div className="space-y-1">
                    <Label>Sucursales</Label>
                    <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border p-3">
                      {locations.map((loc) => (
                        <label
                          key={loc.id}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={locationIds.includes(loc.id)}
                            onCheckedChange={() =>
                              setLocationIds((prev) => toggleId(prev, loc.id))
                            }
                          />
                          <span>{loc.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locationIds.length === 0
                        ? "Sin marcar = acceso a todas las sucursales."
                        : "Solo verá y operará en las sucursales marcadas."}
                    </p>
                  </div>
                )}
                <AccessChecklist
                  selected={sectionKeys}
                  onToggle={(key) => setSectionKeys((prev) => toggleId(prev, key))}
                  isAdmin={role === "admin"}
                  saasPanel={saasPanel}
                  onToggleSaas={setSaasPanel}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="brand"
                  disabled={isSaving || !fullName.trim() || !email.trim()}
                  onClick={handleCreate}
                >
                  {isSaving ? "Creando..." : "Crear usuario"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <Card className="shadow-card">
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                {multiLocal && <TableHead>Sucursales</TableHead>}
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={multiLocal ? 6 : 5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Cargando equipo...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && team.length === 0 && (
                <TableRow>
                  <TableCell colSpan={multiLocal ? 6 : 5}>
                    <EmptyState
                      emoji="👥"
                      title="Sin usuarios"
                      description="Agrega cajeros u operadores a tu equipo."
                    />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                team.map((user) => {
                  const isSelf = user.id === session?.userId;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ROLE_LABELS[user.role as StoreRole] ?? user.role}
                        </Badge>
                      </TableCell>
                      {multiLocal && (
                        <TableCell className="text-muted-foreground">
                          {locationNames(user.locationIds)}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant={user.active ? "success" : "outline"}>
                          {user.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">Tú</span>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar usuario"
                              onClick={() => openEdit(user)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              aria-label="Eliminar usuario"
                              onClick={() => askDelete(user)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Editar usuario */}
      <Dialog open={!!editing} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Rol</Label>
              <Select value={editRole} onValueChange={(v) => handleEditRoleChange(v as StoreRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Cajero</SelectItem>
                  <SelectItem value="operador">Operador</SelectItem>
                  <SelectItem value="finanzas">Finanzas</SelectItem>
                  <SelectItem value="admin">Administrador de tienda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {multiLocal && (
              <div className="space-y-1">
                <Label>Sucursales</Label>
                <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border p-3">
                  {locations.map((loc) => (
                    <label
                      key={loc.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={editLocationIds.includes(loc.id)}
                        onCheckedChange={() =>
                          setEditLocationIds((prev) => toggleId(prev, loc.id))
                        }
                      />
                      <span>{loc.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {editLocationIds.length === 0
                    ? "Sin marcar = acceso a todas las sucursales."
                    : "Solo verá y operará en las sucursales marcadas."}
                </p>
              </div>
            )}
            <AccessChecklist
              selected={editSectionKeys}
              onToggle={(key) => setEditSectionKeys((prev) => toggleId(prev, key))}
              isAdmin={editRole === "admin"}
              saasPanel={editSaasPanel}
              onToggleSaas={setEditSaasPanel}
            />
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-3">
                <Label>Activo</Label>
                <p className="text-xs text-muted-foreground">
                  Si lo desactivas, no podrá iniciar sesión.
                </p>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
            <div className="space-y-1">
              <Label>Nueva contraseña (opcional)</Label>
              <Input
                type="password"
                value={editPassword}
                onChange={(event) => setEditPassword(event.target.value)}
                placeholder="Dejar en blanco para no cambiar"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isEditSaving || !editName.trim()}
              onClick={handleUpdate}
            >
              {isEditSaving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar usuario */}
      <AlertDialog open={!!deleting} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar usuario</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la cuenta de <strong>{deleting?.name}</strong>. Esta acción no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

// Casillas de "Accesos": qué secciones del panel izquierdo ve el usuario. Para
// administradores, además ofrece otorgar el Panel SaaS.
function AccessChecklist({
  selected,
  onToggle,
  isAdmin,
  saasPanel,
  onToggleSaas,
}: {
  selected: string[];
  onToggle: (key: string) => void;
  isAdmin: boolean;
  saasPanel: boolean;
  onToggleSaas: (value: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>Accesos del panel</Label>
      <div className="grid max-h-56 gap-3 overflow-y-auto rounded-lg border p-3">
        {SECTION_GROUPS.map((group) => (
          <div key={group.group} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.group}
            </p>
            {group.items.map((section) => (
              <label
                key={section.key}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={selected.includes(section.key)}
                  onCheckedChange={() => onToggle(section.key)}
                />
                <span>{section.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        El usuario solo verá en su menú las secciones marcadas.
      </p>
      {isAdmin && (
        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg border p-3">
          <span className="pr-3">
            <span className="block text-sm font-medium">Panel SaaS</span>
            <span className="block text-xs text-muted-foreground">
              Acceso al panel de plataforma (todas las empresas). Solo para administradores de
              confianza.
            </span>
          </span>
          <Checkbox checked={saasPanel} onCheckedChange={(v) => onToggleSaas(!!v)} />
        </label>
      )}
    </div>
  );
}
