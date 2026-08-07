// Denominaciones de billetes y monedas mexicanas para el arqueo de caja por
// denominación. Debe coincidir exactamente con la lista que valida el RPC
// `submit_till_count` en supabase/install/01_install.sql -- una denominación
// que no esté aquí, el servidor la rechaza.
export const PESO_DENOMINATIONS = [
  1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5,
] as const;

export type PesoDenomination = (typeof PESO_DENOMINATIONS)[number];
