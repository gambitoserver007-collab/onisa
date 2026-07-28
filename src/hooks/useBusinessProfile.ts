import { getBusinessProfile, type BusinessProfile } from "@/lib/businessProfiles";
import { useBusinessSettings } from "./useBusinessSettings";

// Perfil de negocio activo (rubro) + capacidades derivadas. Lee de los ajustes de
// negocio (reactivos), que se sincronizan desde la empresa al iniciar sesión y al
// guardar Configuración.
export function useBusinessProfile(): {
  profile: BusinessProfile;
  businessType: string;
  usesVariants: boolean;
} {
  const { settings } = useBusinessSettings();
  const profile = getBusinessProfile(settings.businessType);
  return {
    profile,
    businessType: settings.businessType ?? profile.id,
    usesVariants: profile.usesVariants,
  };
}
