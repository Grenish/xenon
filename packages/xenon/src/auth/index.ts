import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import type { DatabaseAdapter } from "../adapters/types";
import type { XenonConfig, XenonRole, XenonUser } from "../core/types";
import type { XenonAuth } from "../server/types";

const DEV_SECRET = "xenon-dev-secret-do-not-use-in-production-0000";

export const AUTH_MODELS = {
  user: "xenon_users",
  session: "xenon_sessions",
  account: "xenon_accounts",
  verification: "xenon_verifications",
} as const;

/** The app secret (config, XENON_SECRET or BETTER_AUTH_SECRET; a fixed dev secret outside production). */
export function resolveSecret(config: XenonConfig): string {
  const secret = config.auth?.secret ?? process.env.XENON_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("[xenon] Missing auth secret. Set XENON_SECRET (or config.auth.secret) in production.");
  }
  return DEV_SECRET;
}

/** BetterAuth options for a Xenon config (without `database`). */
export function xenonAuthOptions(config: XenonConfig, extraPlugins: BetterAuthPlugin[] = []): BetterAuthOptions {
  return {
    appName: "XenonCMS",
    secret: resolveSecret(config),
    baseURL: config.auth?.baseURL ?? process.env.XENON_URL ?? process.env.BETTER_AUTH_URL,
    basePath: `${config.api.path}/auth`,
    trustedOrigins: config.auth?.trustedOrigins ? [...config.auth.trustedOrigins] : undefined,
    // Public sign-up is off: users are created by admins (or the first-run bootstrap).
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
    user: { modelName: AUTH_MODELS.user },
    session: { modelName: AUTH_MODELS.session },
    account: { modelName: AUTH_MODELS.account },
    verification: { modelName: AUTH_MODELS.verification },
    plugins: [admin({ defaultRole: "editor", adminRoles: ["admin"] }), ...extraPlugins],
  };
}

export async function createXenonAuth(
  config: XenonConfig,
  db: DatabaseAdapter,
  extraPlugins: BetterAuthPlugin[] = [],
): Promise<XenonAuth> {
  const options = xenonAuthOptions(config, extraPlugins);
  options.database = await db.getAuthDatabase(options);
  return betterAuth(options) as unknown as XenonAuth;
}

export function toRole(role: string | null | undefined): XenonRole {
  return role?.split(",").map((r) => r.trim()).includes("admin") ? "admin" : "editor";
}

const COMPARE_KEY = randomBytes(32);

/**
 * Constant-time string comparison that hides length differences by comparing fixed-size HMAC
 * digests keyed with a per-process random secret.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", COMPARE_KEY).update(a).digest();
  const hb = createHmac("sha256", COMPARE_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Resolve a user from `Authorization: Bearer <apiKey>` or the BetterAuth session cookie. */
export async function resolveUser(
  config: XenonConfig,
  auth: XenonAuth | null,
  headers: Headers,
): Promise<XenonUser | null> {
  const authorization = headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const keys = config.auth?.apiKeys ?? [];
    let matchIndex = -1;
    for (let i = 0; i < keys.length; i++) {
      if (safeEqual(keys[i]!.key, bearer) && matchIndex === -1) matchIndex = i;
    }
    // An invalid API key is never silently downgraded to cookie auth.
    if (matchIndex === -1) return null;
    const match = keys[matchIndex]!;
    const name = match.name ?? `key-${matchIndex}`;
    return { id: `apikey:${name}`, email: "", name, role: match.role };
  }
  if (!auth) return null;
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    role: toRole(session.user.role),
  };
}
