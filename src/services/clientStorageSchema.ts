export type ClientStoreName =
  | "layout"
  | "composer"
  | "threads"
  | "app"
  | "leida";

export const ALL_CLIENT_STORES: ClientStoreName[] = [
  "layout",
  "composer",
  "threads",
  "app",
  "leida",
];

export const CLIENT_STORE_SCHEMA_VERSION = 1;
export const CLIENT_STORE_SCHEMA_VERSION_KEY = "__schemaVersion";

export type ClientStoreRecoveryReason =
  | null
  | "invalid_root"
  | "legacy_missing_schema"
  | "invalid_schema_version";

export type ClientStoreNormalizationResult = {
  data: Record<string, unknown>;
  recoveryReason: ClientStoreRecoveryReason | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeClientStoreSnapshot(
  raw: unknown,
): ClientStoreNormalizationResult {
  if (raw == null) {
    return {
      data: {},
      recoveryReason: null,
    };
  }

  if (!isPlainRecord(raw)) {
    return {
      data: {},
      recoveryReason: "invalid_root",
    };
  }

  const schemaVersion = raw[CLIENT_STORE_SCHEMA_VERSION_KEY];
  const normalized: Record<string, unknown> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (key === CLIENT_STORE_SCHEMA_VERSION_KEY) {
      return;
    }
    normalized[key] = value;
  });

  if (schemaVersion === undefined) {
    return {
      data: normalized,
      recoveryReason: "legacy_missing_schema",
    };
  }

  if (schemaVersion !== CLIENT_STORE_SCHEMA_VERSION) {
    return {
      data: normalized,
      recoveryReason: "invalid_schema_version",
    };
  }

  return {
    data: normalized,
    recoveryReason: null,
  };
}

export function serializeClientStoreSnapshot(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    [CLIENT_STORE_SCHEMA_VERSION_KEY]: CLIENT_STORE_SCHEMA_VERSION,
    ...data,
  };
}
