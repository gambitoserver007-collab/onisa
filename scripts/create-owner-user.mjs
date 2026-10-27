import { createClient } from "@supabase/supabase-js";
import {
  OWNER_MARK,
  decideOwnerUserAction,
} from "./owner-bootstrap-policy.mjs";

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OWNER_EMAIL",
  "OWNER_PASSWORD",
];

const missing = requiredEnv.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL.trim();

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();

const ownerEmail = process.env.OWNER_EMAIL.trim().toLowerCase();

const ownerPassword = process.env.OWNER_PASSWORD;

const ownerFullName =
  process.env.OWNER_FULL_NAME?.trim() || "Owner Tienda Agil";

const resetOwnerPassword = process.env.RESET_OWNER_PASSWORD === "true";

const adoptExistingOwner = process.env.ADOPT_EXISTING_OWNER === "true";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw error;
    }

    const found = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );

    if (found || data.users.length < 1000) {
      return found ?? null;
    }
  }

  return null;
}

async function upsertOwnerUser() {
  const existingUser = await findUserByEmail(ownerEmail);
  const decision = decideOwnerUserAction({
    existingUser,
    adoptExisting: adoptExistingOwner,
    resetPassword: resetOwnerPassword,
  });

  if (decision.action === "abort") {
    if (existingUser) {
      console.error(
        `Cuenta existente: creada ${existingUser.created_at}, ultimo acceso ${existingUser.last_sign_in_at ?? "nunca"}.`,
      );
    }

    throw new Error(decision.reason);
  }

  if (decision.action === "create") {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: ownerFullName },
      // app_metadata solo lo escribe la service_role: un registro publico no puede
      // ponerse esta marca (bootstrap_owner_profile la exige).
      app_metadata: { [OWNER_MARK]: true },
    });

    if (error) {
      throw error;
    }

    console.log(`Owner Auth user created: ${data.user.email}`);

    return data.user;
  }

  const updatePayload = {
    email_confirm: true,
    user_metadata: {
      ...(existingUser.user_metadata ?? {}),
      full_name: ownerFullName,
    },
    app_metadata: { ...(existingUser.app_metadata ?? {}), [OWNER_MARK]: true },
  };

  if (resetOwnerPassword) {
    updatePayload.password = ownerPassword;
  }

  const { data, error } = await supabase.auth.admin.updateUserById(
    existingUser.id,
    updatePayload,
  );

  if (error) {
    throw error;
  }

  console.log(
    decision.action === "adopt"
      ? `Owner Auth user adopted: password reset and marked as owner: ${data.user.email}`
      : resetOwnerPassword
        ? `Owner Auth user updated and password reset: ${data.user.email}`
        : `Owner Auth user already exists: ${data.user.email}`,
  );

  return data.user;
}

try {
  await upsertOwnerUser();

  const { error } = await supabase.rpc("bootstrap_owner_profile", {
    p_owner_email: ownerEmail,
  });

  if (error) {
    throw error;
  }

  console.log("Owner profile bootstrapped as private admin.");
  console.log(
    "Done. Keep this account private and change it after first login.",
  );
} catch (error) {
  console.error("Owner setup failed:");
  console.error(error.message ?? error);
  process.exit(1);
}
