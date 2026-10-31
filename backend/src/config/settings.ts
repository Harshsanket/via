import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { ApiError } from "../utils/api-error.js";
import { logger } from "../utils/logger.js";
import { env } from "./env.js";

export type ShortLinkMode = "numeric" | "alphanumeric";

export interface ShortLinkSettings {
  mode: ShortLinkMode;
  length: number;
}

export interface SessionSettings {
  ttlSeconds: number;
  refreshTtlSeconds: number;
  maxLifetimeSeconds: number;
  expiryWarningSeconds: number;
  completedTtlSeconds: number;
}

export interface LimitSettings {
  maxActiveSessionsPerPeer: number;
  maxSocketsPerIp: number;
  maxFileSizeBytes: number;
  shortCodeAttemptsPerMinute: number;
}

export interface NetworkSettings {
  stunUrls: string[];
  turnUrls: string[];
  turnCredentialTtlSeconds: number;
}

export interface AdminPublicSettings {
  username: string;
  mustChangePassword: boolean;
}

export interface AdminStoredSettings extends AdminPublicSettings {
  passwordHash: string;
  passwordSalt: string;
  authVersion: number;
  tokenSecret: string;
}

export interface PublicSettings {
  shortLinks: ShortLinkSettings;
  sessions: SessionSettings;
  limits: LimitSettings;
  network: NetworkSettings;
  admin: AdminPublicSettings;
}

export interface StoredSettings extends Omit<PublicSettings, "admin"> {
  admin: AdminStoredSettings;
}

export interface AdminTokenPayload {
  sub: string;
  exp: number;
  ver: number;
}

const ADMIN_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const ADMIN_TOKEN_TTL_SECONDS = 30 * 60;
const MAX_SETTING_URLS = 10;
const MAX_SETTING_URL_LENGTH = 512;

const settingsPath =
  process.env.SETTINGS_PATH?.trim() ||
  (process.env.NODE_ENV === "test"
    ? resolve(tmpdir(), `via-settings-${process.pid}.json`)
    : resolve(process.cwd(), "data", "settings.json"));

const hashPassword = (password: string, salt: string): string =>
  scryptSync(password, salt, 64).toString("base64");

const newAdminDefaults = (): AdminStoredSettings => {
  const passwordSalt = randomBytes(16).toString("base64");
  return {
    username: "admin",
    passwordHash: hashPassword("admin", passwordSalt),
    passwordSalt,
    authVersion: 0,
    mustChangePassword: true,
    tokenSecret: randomBytes(32).toString("base64url"),
  };
};

const defaults = (): StoredSettings => ({
  shortLinks: { mode: "numeric", length: 4 },
  sessions: {
    ttlSeconds: env.sessionTtlSeconds,
    refreshTtlSeconds: env.refreshSessionTtlSeconds,
    maxLifetimeSeconds: env.sessionMaxLifetimeSeconds,
    expiryWarningSeconds: env.sessionExpiryWarningSeconds,
    completedTtlSeconds: env.completedSessionTtlSeconds,
  },
  limits: {
    maxActiveSessionsPerPeer: env.maxActiveSessionsPerPeer,
    maxSocketsPerIp: env.maxSocketsPerIp,
    maxFileSizeBytes: env.maxFileSizeBytes,
    shortCodeAttemptsPerMinute: 15,
  },
  network: {
    stunUrls: [...env.stunUrls],
    turnUrls: [...env.turnUrls],
    turnCredentialTtlSeconds: env.turnCredentialTtlSeconds,
  },
  admin: newAdminDefaults(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positiveInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return fallback;
  if (value < min || value > max) return fallback;
  return value;
};

const stringList = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.length > 0 &&
        entry.length <= MAX_SETTING_URL_LENGTH &&
        /^(stuns?|turns?):/i.test(entry),
    )
    .slice(0, MAX_SETTING_URLS);
  return entries;
};

const normalizeShortLinks = (
  value: unknown,
  fallback: ShortLinkSettings,
): ShortLinkSettings => {
  if (!isRecord(value)) return { ...fallback };
  const mode = value.mode === "alphanumeric" ? "alphanumeric" : "numeric";
  const length = positiveInt(value.length, fallback.length, 4, 6);
  return { mode, length };
};

const normalizeSettings = (
  raw: unknown,
  current: StoredSettings,
): StoredSettings => {
  if (!isRecord(raw)) return current;

  const sessions = isRecord(raw.sessions) ? raw.sessions : {};
  const limits = isRecord(raw.limits) ? raw.limits : {};
  const network = isRecord(raw.network) ? raw.network : {};
  const admin = isRecord(raw.admin) ? raw.admin : {};

  const username =
    typeof admin.username === "string" &&
    ADMIN_USERNAME_PATTERN.test(admin.username)
      ? admin.username
      : current.admin.username;

  return {
    shortLinks: normalizeShortLinks(raw.shortLinks, current.shortLinks),
    sessions: {
      ttlSeconds: positiveInt(
        sessions.ttlSeconds,
        current.sessions.ttlSeconds,
        1,
        7 * 24 * 60 * 60,
      ),
      refreshTtlSeconds: positiveInt(
        sessions.refreshTtlSeconds,
        current.sessions.refreshTtlSeconds,
        1,
        7 * 24 * 60 * 60,
      ),
      maxLifetimeSeconds: positiveInt(
        sessions.maxLifetimeSeconds,
        current.sessions.maxLifetimeSeconds,
        1,
        30 * 24 * 60 * 60,
      ),
      expiryWarningSeconds: positiveInt(
        sessions.expiryWarningSeconds,
        current.sessions.expiryWarningSeconds,
        0,
        60 * 60,
      ),
      completedTtlSeconds: positiveInt(
        sessions.completedTtlSeconds,
        current.sessions.completedTtlSeconds,
        1,
        60 * 60,
      ),
    },
    limits: {
      maxActiveSessionsPerPeer: positiveInt(
        limits.maxActiveSessionsPerPeer,
        current.limits.maxActiveSessionsPerPeer,
        1,
        10,
      ),
      maxSocketsPerIp: positiveInt(
        limits.maxSocketsPerIp,
        current.limits.maxSocketsPerIp,
        1,
        200,
      ),
      maxFileSizeBytes: positiveInt(
        limits.maxFileSizeBytes,
        current.limits.maxFileSizeBytes,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      shortCodeAttemptsPerMinute: positiveInt(
        limits.shortCodeAttemptsPerMinute,
        current.limits.shortCodeAttemptsPerMinute,
        1,
        1000,
      ),
    },
    network: {
      stunUrls: stringList(network.stunUrls, current.network.stunUrls),
      turnUrls: stringList(network.turnUrls, current.network.turnUrls),
      turnCredentialTtlSeconds: positiveInt(
        network.turnCredentialTtlSeconds,
        current.network.turnCredentialTtlSeconds,
        60,
        7 * 24 * 60 * 60,
      ),
    },
    admin: {
      username,
      passwordHash:
        typeof admin.passwordHash === "string" && admin.passwordHash.length > 0
          ? admin.passwordHash
          : current.admin.passwordHash,
      passwordSalt:
        typeof admin.passwordSalt === "string" && admin.passwordSalt.length > 0
          ? admin.passwordSalt
          : current.admin.passwordSalt,
      authVersion: positiveInt(
        admin.authVersion,
        current.admin.authVersion,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      mustChangePassword:
        typeof admin.mustChangePassword === "boolean"
          ? admin.mustChangePassword
          : current.admin.mustChangePassword,
      tokenSecret:
        typeof admin.tokenSecret === "string" && admin.tokenSecret.length >= 32
          ? admin.tokenSecret
          : current.admin.tokenSecret,
    },
  };
};

const writeSettingsFile = (value: StoredSettings): void => {
  const directory = dirname(settingsPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, settingsPath);
};

const readSettingsFile = (current: StoredSettings): StoredSettings | null => {
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    return normalizeSettings(parsed, current);
  } catch (error) {
    logger.error({ err: error }, "[SETTINGS] :: unable to read settings file");
    return null;
  }
};

let settings: StoredSettings = (() => {
  const initial = defaults();
  const stored = readSettingsFile(initial);
  if (stored) return stored;

  try {
    writeSettingsFile(initial);
  } catch (error) {
    logger.error(
      { err: error, path: settingsPath },
      "[SETTINGS] :: unable to create settings file; using defaults in memory",
    );
  }
  return initial;
})();

export const getSettings = (): StoredSettings => settings;

export const getPublicSettings = (): PublicSettings => ({
  shortLinks: { ...settings.shortLinks },
  sessions: { ...settings.sessions },
  limits: { ...settings.limits },
  network: {
    stunUrls: [...settings.network.stunUrls],
    turnUrls: [...settings.network.turnUrls],
    turnCredentialTtlSeconds: settings.network.turnCredentialTtlSeconds,
  },
  admin: {
    username: settings.admin.username,
    mustChangePassword: settings.admin.mustChangePassword,
  },
});

export const getSettingsPath = (): string => settingsPath;

const assertInteger = (
  value: unknown,
  field: string,
  min: number,
  max: number,
): void => {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new ApiError(400, `${field} invalid`);
  }
};

const validateSettingsPatch = (patch: Record<string, unknown>): void => {
  if (patch.shortLinks !== undefined) {
    if (!isRecord(patch.shortLinks)) {
      throw new ApiError(400, "shortLinks invalid");
    }
    const { mode, length } = patch.shortLinks;
    if (mode !== undefined && mode !== "numeric" && mode !== "alphanumeric") {
      throw new ApiError(400, "short link mode invalid");
    }
    assertInteger(length, "short link length", 4, 6);
  }

  const sections = ["sessions", "limits", "network"] as const;
  for (const section of sections) {
    if (patch[section] !== undefined && !isRecord(patch[section])) {
      throw new ApiError(400, `${section} invalid`);
    }
  }

  const sessions = isRecord(patch.sessions) ? patch.sessions : {};
  assertInteger(sessions.ttlSeconds, "session TTL", 1, 7 * 24 * 60 * 60);
  assertInteger(sessions.refreshTtlSeconds, "refresh TTL", 1, 7 * 24 * 60 * 60);
  assertInteger(
    sessions.maxLifetimeSeconds,
    "maximum lifetime",
    1,
    30 * 24 * 60 * 60,
  );
  assertInteger(sessions.expiryWarningSeconds, "expiry warning", 0, 60 * 60);
  assertInteger(sessions.completedTtlSeconds, "completed TTL", 1, 60 * 60);

  const limits = isRecord(patch.limits) ? patch.limits : {};
  assertInteger(limits.maxActiveSessionsPerPeer, "sessions per peer", 1, 10);
  assertInteger(limits.maxSocketsPerIp, "sockets per IP", 1, 200);
  assertInteger(
    limits.maxFileSizeBytes,
    "maximum file size",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  assertInteger(
    limits.shortCodeAttemptsPerMinute,
    "short-code attempt limit",
    1,
    1000,
  );

  const network = isRecord(patch.network) ? patch.network : {};
  assertInteger(
    network.turnCredentialTtlSeconds,
    "TURN credential TTL",
    60,
    7 * 24 * 60 * 60,
  );
  for (const key of ["stunUrls", "turnUrls"] as const) {
    if (network[key] === undefined) continue;
    if (!Array.isArray(network[key])) {
      throw new ApiError(400, `${key} invalid`);
    }
    if (
      network[key].length > MAX_SETTING_URLS ||
      network[key].some(
        (entry) =>
          typeof entry !== "string" ||
          entry.length === 0 ||
          entry.length > MAX_SETTING_URL_LENGTH ||
          !/^(stuns?|turns?):/i.test(entry),
      )
    ) {
      throw new ApiError(400, `${key} invalid`);
    }
  }
};

/** Applies a partial, validated update and persists it atomically. */
export const updateSettings = (patch: unknown): PublicSettings => {
  if (!isRecord(patch)) {
    throw new ApiError(400, "settings payload invalid");
  }

  // Admin credentials have their own endpoint and current-password check.
  const safePatch = { ...patch };
  delete safePatch.admin;

  validateSettingsPatch(safePatch);
  const next = normalizeSettings(safePatch, settings);
  settings = next;
  try {
    writeSettingsFile(next);
  } catch (error) {
    logger.error({ err: error }, "[SETTINGS] :: unable to save settings");
    throw new ApiError(500, "unable to save settings");
  }
  return getPublicSettings();
};

export const verifyAdminCredentials = (
  username: string,
  password: string,
): boolean => {
  if (username !== settings.admin.username) return false;
  const expected = Buffer.from(settings.admin.passwordHash, "base64");
  const actual = Buffer.from(
    hashPassword(password, settings.admin.passwordSalt),
    "base64",
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const signTokenPayload = (payload: string): string =>
  createHmac("sha256", settings.admin.tokenSecret)
    .update(payload)
    .digest("base64url");

export const issueAdminToken = (): { token: string; expiresAt: number } => {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SECONDS;
  const payload: AdminTokenPayload = {
    sub: settings.admin.username,
    exp: expiresAt,
    ver: settings.admin.authVersion,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${encoded}.${signTokenPayload(encoded)}`, expiresAt };
};

export const verifyAdminToken = (token: string): AdminTokenPayload | null => {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = Buffer.from(signTokenPayload(encoded), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<AdminTokenPayload>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.ver !== "number" ||
      payload.sub !== settings.admin.username ||
      payload.ver !== settings.admin.authVersion ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload as AdminTokenPayload;
  } catch {
    return null;
  }
};

export const updateAdminCredentials = (params: {
  currentPassword: string;
  username: string;
  newPassword: string;
}): { token: string; expiresAt: number } => {
  if (
    !verifyAdminCredentials(settings.admin.username, params.currentPassword)
  ) {
    throw new ApiError(403, "current password is incorrect");
  }
  if (!ADMIN_USERNAME_PATTERN.test(params.username)) {
    throw new ApiError(
      400,
      "username must be 3-32 characters using letters, numbers, dot, dash or underscore",
    );
  }
  if (params.newPassword.length < 8 || params.newPassword.length > 128) {
    throw new ApiError(400, "password must be 8-128 characters");
  }
  if (verifyAdminCredentials(settings.admin.username, params.newPassword)) {
    throw new ApiError(400, "choose a password different from the current one");
  }

  const passwordSalt = randomBytes(16).toString("base64");
  const next: StoredSettings = {
    ...settings,
    admin: {
      ...settings.admin,
      username: params.username,
      passwordSalt,
      passwordHash: hashPassword(params.newPassword, passwordSalt),
      authVersion: settings.admin.authVersion + 1,
      mustChangePassword: false,
    },
  };

  settings = next;
  try {
    writeSettingsFile(next);
  } catch (error) {
    logger.error(
      { err: error },
      "[SETTINGS] :: unable to save admin credentials",
    );
    throw new ApiError(500, "unable to save credentials");
  }
  return issueAdminToken();
};
