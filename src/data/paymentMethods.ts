export type PaymentMethodKind =
  | "cash"
  | "card"
  | "bank_transfer"
  | "instant_transfer"
  | "wallet"
  | "qr"
  | "voucher"
  | "bnpl"
  | "crypto"
  | "credit"
  | "other";

export interface PaymentMethodDefinition {
  id: string;
  label: string;
  kind: PaymentMethodKind;
  recommended?: boolean;
  description?: string;
}

export const PAYMENT_METHOD_KIND_LABELS: Record<PaymentMethodKind, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bank_transfer: "Transferencia bancaria",
  instant_transfer: "Transferencia inmediata",
  wallet: "Billetera digital",
  qr: "QR",
  voucher: "Pago en agente/código",
  bnpl: "Financiamiento",
  crypto: "Cripto",
  credit: "Crédito",
  other: "Otro",
};

export const PAYMENT_METHOD_KINDS = Object.keys(
  PAYMENT_METHOD_KIND_LABELS,
) as PaymentMethodKind[];

export const BASE_PAYMENT_METHODS: PaymentMethodDefinition[] = [
  {
    id: "cash",
    label: "Efectivo",
    kind: "cash",
    recommended: true,
    description: "Cobro presencial en moneda local.",
  },
  {
    id: "debit-card",
    label: "Tarjeta de débito",
    kind: "card",
    recommended: true,
    description: "POS físico, lector móvil o pasarela local.",
  },
  {
    id: "credit-card",
    label: "Tarjeta de crédito",
    kind: "card",
    recommended: true,
    description: "POS físico, lector móvil o pasarela local.",
  },
  {
    id: "bank-transfer",
    label: "Transferencia bancaria",
    kind: "bank_transfer",
    recommended: true,
    description: "Transferencia manual o comprobante bancario.",
  },
  {
    id: "payment-link",
    label: "Link de pago",
    kind: "other",
    description: "Cobro por enlace generado en una pasarela.",
  },
];

export const PAYMENT_METHODS_BY_COUNTRY: Record<
  string,
  PaymentMethodDefinition[]
> = {
  AR: [
    {
      id: "ar-mercado-pago",
      label: "Mercado Pago",
      kind: "wallet",
      recommended: true,
    },
    { id: "ar-modo", label: "MODO", kind: "wallet", recommended: true },
    { id: "ar-cuenta-dni", label: "Cuenta DNI", kind: "wallet" },
    {
      id: "ar-qr-interoperable",
      label: "QR interoperable",
      kind: "qr",
      recommended: true,
    },
    {
      id: "ar-transferencia-30",
      label: "Transferencia 3.0",
      kind: "instant_transfer",
    },
    { id: "ar-uala", label: "Ualá", kind: "wallet" },
    { id: "ar-naranja-x", label: "Naranja X", kind: "wallet" },
    { id: "ar-pago-facil", label: "Pago Fácil", kind: "voucher" },
    { id: "ar-rapipago", label: "Rapipago", kind: "voucher" },
  ],
  BO: [
    { id: "bo-qr-simple", label: "QR Simple", kind: "qr", recommended: true },
    { id: "bo-simple", label: "Simple", kind: "wallet", recommended: true },
    { id: "bo-tigo-money", label: "Tigo Money", kind: "wallet" },
    { id: "bo-soli", label: "Soli", kind: "wallet" },
    { id: "bo-pagofacil", label: "PagoFácil Bolivia", kind: "voucher" },
  ],
  BR: [
    { id: "br-pix", label: "Pix", kind: "instant_transfer", recommended: true },
    { id: "br-pix-qr", label: "Pix QR", kind: "qr", recommended: true },
    { id: "br-boleto", label: "Boleto Bancário", kind: "voucher" },
    { id: "br-picpay", label: "PicPay", kind: "wallet" },
    { id: "br-mercado-pago", label: "Mercado Pago", kind: "wallet" },
    { id: "br-nubank", label: "Nubank", kind: "wallet" },
    { id: "br-ted-doc", label: "TED/DOC", kind: "bank_transfer" },
  ],
  CL: [
    { id: "cl-redcompra", label: "Redcompra", kind: "card", recommended: true },
    { id: "cl-webpay", label: "Webpay", kind: "card", recommended: true },
    { id: "cl-mach", label: "MACH", kind: "wallet", recommended: true },
    { id: "cl-mercado-pago", label: "Mercado Pago", kind: "wallet" },
    { id: "cl-servipag", label: "Servipag", kind: "voucher" },
    { id: "cl-khipu", label: "Khipu", kind: "bank_transfer" },
    { id: "cl-fpay", label: "Fpay", kind: "wallet" },
  ],
  CO: [
    { id: "co-pse", label: "PSE", kind: "bank_transfer", recommended: true },
    { id: "co-nequi", label: "Nequi", kind: "wallet", recommended: true },
    { id: "co-nequi-qr", label: "Nequi QR", kind: "qr", recommended: true },
    {
      id: "co-daviplata",
      label: "Daviplata",
      kind: "wallet",
      recommended: true,
    },
    { id: "co-bre-b", label: "Bre-B", kind: "instant_transfer" },
    { id: "co-bancolombia", label: "Bancolombia", kind: "bank_transfer" },
    { id: "co-efecty", label: "Efecty", kind: "voucher" },
    { id: "co-mercado-pago", label: "Mercado Pago", kind: "wallet" },
    { id: "co-addi", label: "Addi", kind: "bnpl" },
  ],
  EC: [
    { id: "ec-deuna", label: "DeUna!", kind: "wallet", recommended: true },
    { id: "ec-payphone", label: "PayPhone", kind: "wallet", recommended: true },
    {
      id: "ec-transferencia",
      label: "Transferencia interbancaria",
      kind: "bank_transfer",
    },
    { id: "ec-datafast", label: "Datafast", kind: "card" },
    { id: "ec-medianet", label: "Medianet", kind: "card" },
    { id: "ec-kushki", label: "Kushki", kind: "other" },
  ],
  GY: [
    { id: "gy-mmg", label: "MMG+", kind: "wallet", recommended: true },
    { id: "gy-mobile-money", label: "Mobile Money Guyana", kind: "wallet" },
    {
      id: "gy-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
  ],
  PY: [
    { id: "py-bancard-qr", label: "QR Bancard", kind: "qr", recommended: true },
    {
      id: "py-tigo-money",
      label: "Tigo Money",
      kind: "wallet",
      recommended: true,
    },
    { id: "py-personal-pay", label: "Personal Pay", kind: "wallet" },
    { id: "py-aqui-pago", label: "Aquí Pago", kind: "voucher" },
    { id: "py-pago-express", label: "Pago Express", kind: "voucher" },
  ],
  PE: [
    { id: "pe-yape", label: "Yape", kind: "wallet", recommended: true },
    { id: "pe-plin", label: "Plin", kind: "wallet", recommended: true },
    { id: "pe-pagoefectivo", label: "PagoEfectivo", kind: "voucher" },
    { id: "pe-izipay", label: "Izipay", kind: "card" },
    { id: "pe-niubiz", label: "Niubiz", kind: "card" },
    { id: "pe-tunki", label: "Tunki", kind: "wallet" },
    {
      id: "pe-transferencia",
      label: "Transferencia interbancaria",
      kind: "bank_transfer",
    },
  ],
  SR: [
    {
      id: "sr-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "sr-mobile-banking", label: "Banca móvil", kind: "wallet" },
    { id: "sr-qr", label: "Pago QR", kind: "qr" },
  ],
  UY: [
    {
      id: "uy-mercado-pago",
      label: "Mercado Pago",
      kind: "wallet",
      recommended: true,
    },
    { id: "uy-prex", label: "Prex", kind: "wallet" },
    { id: "uy-oca-blue", label: "OCA Blue", kind: "wallet" },
    { id: "uy-midinero", label: "MiDinero", kind: "wallet" },
    { id: "uy-abitab", label: "Abitab", kind: "voucher" },
    { id: "uy-redpagos", label: "RedPagos", kind: "voucher" },
  ],
  VE: [
    {
      id: "ve-pago-movil",
      label: "Pago móvil interbancario",
      kind: "instant_transfer",
      recommended: true,
    },
    {
      id: "ve-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
    { id: "ve-zelle", label: "Zelle", kind: "bank_transfer" },
    { id: "ve-usdt", label: "USDT", kind: "crypto" },
    { id: "ve-binance-pay", label: "Binance Pay", kind: "crypto" },
  ],
  BZ: [
    { id: "bz-e-kyash", label: "E-Kyash", kind: "wallet", recommended: true },
    {
      id: "bz-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "bz-mobile-pay", label: "Pago móvil local", kind: "wallet" },
  ],
  CR: [
    {
      id: "cr-sinpe-movil",
      label: "SINPE Móvil",
      kind: "instant_transfer",
      recommended: true,
    },
    { id: "cr-sinpe", label: "Transferencia SINPE", kind: "bank_transfer" },
    { id: "cr-bn-servicios", label: "BN Servicios", kind: "voucher" },
    { id: "cr-wink", label: "Wink", kind: "wallet" },
    { id: "cr-kash", label: "Kash", kind: "wallet" },
  ],
  SV: [
    {
      id: "sv-chivo",
      label: "Chivo Wallet",
      kind: "wallet",
      recommended: true,
    },
    { id: "sv-bitcoin-lightning", label: "Bitcoin Lightning", kind: "crypto" },
    { id: "sv-tigo-money", label: "Tigo Money", kind: "wallet" },
    { id: "sv-n1co", label: "N1CO", kind: "wallet" },
    {
      id: "sv-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
  ],
  GT: [
    {
      id: "gt-tigo-money",
      label: "Tigo Money",
      kind: "wallet",
      recommended: true,
    },
    { id: "gt-paggo", label: "Paggo", kind: "wallet" },
    {
      id: "gt-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
    { id: "gt-bac-link", label: "BAC Compra Click", kind: "other" },
  ],
  HN: [
    {
      id: "hn-tigo-money",
      label: "Tigo Money",
      kind: "wallet",
      recommended: true,
    },
    { id: "hn-tengo", label: "Tengo", kind: "wallet" },
    { id: "hn-kash", label: "Kash", kind: "wallet" },
    { id: "hn-bac-link", label: "BAC Compra Click", kind: "other" },
    {
      id: "hn-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
  ],
  MX: [
    {
      id: "mx-spei",
      label: "SPEI",
      kind: "instant_transfer",
      recommended: true,
    },
    { id: "mx-codi", label: "CoDi", kind: "qr", recommended: true },
    { id: "mx-oxxo-pay", label: "OXXO Pay", kind: "voucher" },
    { id: "mx-mercado-pago", label: "Mercado Pago", kind: "wallet" },
    { id: "mx-kueski-pay", label: "Kueski Pay", kind: "bnpl" },
    { id: "mx-clip", label: "Clip", kind: "card" },
    { id: "mx-paypal", label: "PayPal", kind: "wallet" },
  ],
  NI: [
    {
      id: "ni-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
      recommended: true,
    },
    { id: "ni-pago-movil", label: "Pago móvil bancario", kind: "wallet" },
    { id: "ni-bac-link", label: "BAC Compra Click", kind: "other" },
    {
      id: "ni-billetera-local",
      label: "Billetera móvil local",
      kind: "wallet",
    },
  ],
  PA: [
    { id: "pa-yappy", label: "Yappy", kind: "wallet", recommended: true },
    { id: "pa-nequi", label: "Nequi Panamá", kind: "wallet" },
    { id: "pa-ach", label: "ACH", kind: "bank_transfer" },
    { id: "pa-ach-xpress", label: "ACH Xpress", kind: "instant_transfer" },
    { id: "pa-punto-pago", label: "Punto Pago", kind: "voucher" },
    { id: "pa-clave", label: "Clave", kind: "card" },
  ],
  AG: [
    { id: "ag-dcash", label: "DCash", kind: "wallet" },
    {
      id: "ag-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "ag-mobile-wallet", label: "Billetera móvil local", kind: "wallet" },
  ],
  BS: [
    {
      id: "bs-sand-dollar",
      label: "Sand Dollar",
      kind: "wallet",
      recommended: true,
    },
    { id: "bs-kanoo", label: "Kanoo", kind: "wallet" },
    {
      id: "bs-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
  ],
  BB: [
    { id: "bb-mmoney", label: "mMoney", kind: "wallet" },
    { id: "bb-surepay", label: "SurePay", kind: "voucher" },
    {
      id: "bb-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
  ],
  CU: [
    {
      id: "cu-transfermovil",
      label: "Transfermóvil",
      kind: "wallet",
      recommended: true,
    },
    { id: "cu-enzona", label: "EnZona", kind: "wallet", recommended: true },
    {
      id: "cu-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
  ],
  DM: [
    { id: "dm-dcash", label: "DCash", kind: "wallet" },
    {
      id: "dm-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "dm-mobile-wallet", label: "Billetera móvil local", kind: "wallet" },
  ],
  GD: [
    { id: "gd-dcash", label: "DCash", kind: "wallet" },
    {
      id: "gd-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "gd-mobile-wallet", label: "Billetera móvil local", kind: "wallet" },
  ],
  HT: [
    { id: "ht-moncash", label: "MonCash", kind: "wallet", recommended: true },
    { id: "ht-natcash", label: "Natcash", kind: "wallet" },
    {
      id: "ht-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
  ],
  JM: [
    { id: "jm-lynk", label: "Lynk", kind: "wallet", recommended: true },
    { id: "jm-ncb-quisk", label: "NCB Quisk", kind: "wallet" },
    {
      id: "jm-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
  ],
  PR: [
    {
      id: "pr-ath-movil",
      label: "ATH Móvil",
      kind: "wallet",
      recommended: true,
    },
    { id: "pr-paypal", label: "PayPal", kind: "wallet" },
    { id: "pr-venmo", label: "Venmo", kind: "wallet" },
    { id: "pr-apple-pay", label: "Apple Pay", kind: "wallet" },
    { id: "pr-google-pay", label: "Google Pay", kind: "wallet" },
  ],
  DO: [
    { id: "do-azul", label: "Azul", kind: "card", recommended: true },
    { id: "do-cardnet", label: "CardNet", kind: "card" },
    { id: "do-tpago", label: "tPago", kind: "wallet" },
    { id: "do-qik", label: "Qik", kind: "wallet" },
    {
      id: "do-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
  ],
  KN: [
    { id: "kn-dcash", label: "DCash", kind: "wallet" },
    {
      id: "kn-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "kn-mobile-wallet", label: "Billetera móvil local", kind: "wallet" },
  ],
  VC: [
    { id: "vc-dcash", label: "DCash", kind: "wallet" },
    {
      id: "vc-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "vc-mobile-wallet", label: "Billetera móvil local", kind: "wallet" },
  ],
  LC: [
    { id: "lc-dcash", label: "DCash", kind: "wallet" },
    {
      id: "lc-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "lc-mobile-wallet", label: "Billetera móvil local", kind: "wallet" },
  ],
  TT: [
    { id: "tt-wipay", label: "WiPay", kind: "wallet", recommended: true },
    { id: "tt-paywise", label: "PayWise", kind: "voucher" },
    {
      id: "tt-bank-transfer",
      label: "Transferencia bancaria local",
      kind: "bank_transfer",
    },
    { id: "tt-endcash", label: "Endcash", kind: "wallet" },
  ],
  GQ: [
    { id: "gq-orange-money", label: "Orange Money", kind: "wallet" },
    { id: "gq-muni", label: "Muni", kind: "wallet" },
    {
      id: "gq-mobile-money-cemac",
      label: "Mobile Money CEMAC",
      kind: "wallet",
    },
    {
      id: "gq-transferencia",
      label: "Transferencia bancaria",
      kind: "bank_transfer",
    },
  ],
};

export function getDefaultCountryPaymentMethods(countryCode: string) {
  return [
    ...BASE_PAYMENT_METHODS,
    ...(PAYMENT_METHODS_BY_COUNTRY[countryCode] ?? []),
  ];
}
