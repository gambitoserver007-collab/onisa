import { createClient } from "@supabase/supabase-js";

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
const ownerEmail = (process.env.OWNER_EMAIL || "owner@tiendaagil.test")
  .trim()
  .toLowerCase();

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const tables = [
  "subscription_plans",
  "platform_settings",
  "country_settings",
  "country_payment_methods",
  "companies",
  "profiles",
  "profile_locations",
  "categories",
  "units",
  "suppliers",
  "customers",
  "locations",
  "products",
  "product_locations",
  "product_variants",
  "product_variant_locations",
  "sales",
  "sale_items",
  "purchases",
  "purchase_items",
  "returns",
  "return_items",
  "stock_movements",
  "cash_sessions",
  "cash_movements",
  "promotions",
];

const results = [];

function pass(label) {
  results.push({ ok: true, label });
  console.log(`OK  ${label}`);
}

function fail(label, details) {
  results.push({ ok: false, label, details });
  console.error(`ERR ${label}`);
  if (details) console.error(`    ${details}`);
}

async function verifyTable(table) {
  const { error } = await supabase.from(table).select("*", {
    count: "exact",
    head: true,
  });

  if (error) {
    fail(`table ${table}`, error.message);
    return;
  }

  pass(`table ${table}`);
}

async function verifyPlans() {
  const expectedPlanIds = [
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000103",
  ];

  const { data, error } = await supabase
    .from("subscription_plans")
    .select("id,is_demo_data")
    .in("id", expectedPlanIds);

  if (error) {
    fail("base subscription plans", error.message);
    return;
  }

  if (data.length !== expectedPlanIds.length) {
    fail(
      "base subscription plans",
      `expected ${expectedPlanIds.length}, found ${data.length}`,
    );
    return;
  }

  const hasDemoPlan = data.some((plan) => plan.is_demo_data);
  if (hasDemoPlan) {
    fail(
      "base subscription plans",
      "base plans must not be marked as demo data",
    );
    return;
  }

  pass("base subscription plans");
}

async function verifyOwnerProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "email,role,is_demo,demo_mode,is_active,company_id,is_platform_admin",
    )
    .ilike("email", ownerEmail)
    .maybeSingle();

  if (error) {
    fail("owner profile", error.message);
    return;
  }

  if (!data) {
    fail("owner profile", `profile not found for ${ownerEmail}`);
    return;
  }

  if (
    data.role !== "admin" ||
    data.is_demo ||
    data.demo_mode !== "none" ||
    !data.is_active ||
    !data.is_platform_admin
  ) {
    fail(
      "owner profile",
      "owner must be active admin, is_demo=false, demo_mode=none, is_platform_admin=true",
    );
    return;
  }

  pass("owner profile");
}

for (const table of tables) {
  await verifyTable(table);
}

await verifyPlans();
await verifyOwnerProfile();

const failures = results.filter((result) => !result.ok);

if (failures.length > 0) {
  console.error(`Verification failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("Supabase install verification passed.");
