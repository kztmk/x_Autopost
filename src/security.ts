const SECURITY_PROP_KEYS = {
  ownerUid: "security_ownerUid",
  proxySecret: "security_proxySecret",
  initializedAt: "security_initializedAt",
  setupCodeHash: "security_setupCodeHash",
  setupCodeExpiresAt: "security_setupCodeExpiresAt",
} as const;

const SETUP_CODE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TOLERANCE_MS = 5 * 60 * 1000;
const REPLAY_CACHE_TTL_SECONDS = 5 * 60;
const AUTH_QUERY_PARAM_KEYS = {
  uid: true,
  firebaseUid: true,
  timestamp: true,
  signature: true,
  requestId: true,
} as const;

interface ProxyAuthPayload {
  uid?: string;
  timestamp?: string | number;
  signature?: string;
  requestId?: string;
}

interface InitializeRequest {
  uid?: string;
  setupCode?: string;
}

export function generateSetupCode(): string {
  const code = createRandomCode();
  const expiresAt = Date.now() + SETUP_CODE_TTL_MS;
  const properties = PropertiesService.getScriptProperties();

  properties.setProperties({
    [SECURITY_PROP_KEYS.setupCodeHash]: sha256Base64(code),
    [SECURITY_PROP_KEYS.setupCodeExpiresAt]: String(expiresAt),
  });

  Logger.log(
    `Setup code generated. It expires at ${new Date(expiresAt).toISOString()}.`
  );
  return code;
}

export function getSecurityStatus() {
  const properties = PropertiesService.getScriptProperties();
  const ownerUid = properties.getProperty(SECURITY_PROP_KEYS.ownerUid);
  const initializedAt = properties.getProperty(SECURITY_PROP_KEYS.initializedAt);
  const setupCodeExpiresAt = properties.getProperty(
    SECURITY_PROP_KEYS.setupCodeExpiresAt
  );

  return {
    initialized: Boolean(ownerUid),
    ownerUid: ownerUid ? maskValue(ownerUid) : "",
    initializedAt: initializedAt || "",
    setupCodeActive:
      Boolean(setupCodeExpiresAt) && Number(setupCodeExpiresAt) > Date.now(),
  };
}

export function initializeProxyAuth(requestData: InitializeRequest) {
  if (!requestData || typeof requestData !== "object") {
    throw new Error("Invalid initialize request body.");
  }

  const uid = normalizeRequiredString(requestData.uid, "uid");
  const setupCode = normalizeRequiredString(requestData.setupCode, "setupCode");
  const properties = PropertiesService.getScriptProperties();
  const expectedHash = properties.getProperty(SECURITY_PROP_KEYS.setupCodeHash);
  const expiresAt = Number(
    properties.getProperty(SECURITY_PROP_KEYS.setupCodeExpiresAt) || "0"
  );

  if (!expectedHash || !expiresAt) {
    throw new Error("Setup code has not been generated.");
  }

  if (Date.now() > expiresAt) {
    clearSetupCode(properties);
    throw new Error("Setup code has expired. Generate a new setup code.");
  }

  if (sha256Base64(setupCode) !== expectedHash) {
    throw new Error("Invalid setup code.");
  }

  const proxySecret = createProxySecret(uid, expectedHash);
  const initializedAt = new Date().toISOString();

  properties.setProperties({
    [SECURITY_PROP_KEYS.ownerUid]: uid,
    [SECURITY_PROP_KEYS.proxySecret]: proxySecret,
    [SECURITY_PROP_KEYS.initializedAt]: initializedAt,
  });
  clearSetupCode(properties);

  return {
    status: "initialized",
    ownerUid: maskValue(uid),
    initializedAt,
    proxySecret,
    signatureAlgorithm: "HMAC_SHA256_BASE64_WEBSAFE",
    signaturePayload:
      "timestamp.uid.action.target.stableJsonPayloadWithoutAuth",
  };
}

export function assertProxyAuthorized(
  e: any,
  action: string,
  target: string,
  requestData: any,
  method: "GET" | "POST"
): void {
  const properties = PropertiesService.getScriptProperties();
  const ownerUid = properties.getProperty(SECURITY_PROP_KEYS.ownerUid);
  const proxySecret = properties.getProperty(SECURITY_PROP_KEYS.proxySecret);

  if (!ownerUid || !proxySecret) {
    throw new Error("Proxy authorization is not initialized.");
  }

  const authPayload = getAuthPayload(e, requestData, method);
  const uid = normalizeRequiredString(authPayload.uid, "_auth.uid");
  const signature = normalizeRequiredString(
    authPayload.signature,
    "_auth.signature"
  );
  const timestampRaw = normalizeRequiredString(
    authPayload.timestamp,
    "_auth.timestamp"
  );
  const timestamp = Number(timestampRaw);

  if (uid !== ownerUid) {
    throw new Error("Firebase UID is not authorized for this spreadsheet.");
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid _auth.timestamp.");
  }

  if (Math.abs(Date.now() - timestamp) > REQUEST_TOLERANCE_MS) {
    throw new Error("Request timestamp is outside the allowed window.");
  }

  const requestId = authPayload.requestId
    ? String(authPayload.requestId).trim()
    : signature;
  assertNotReplay(requestId);

  const bodyForSignature =
    method === "POST" ? stripAuthField(requestData) : getQuerySignatureBody(e);
  const expectedSignature = createRequestSignature(
    proxySecret,
    String(timestamp),
    uid,
    action,
    target,
    bodyForSignature
  );

  if (signature !== expectedSignature) {
    throw new Error("Invalid request signature.");
  }
}

export function stripAuthField<T>(requestData: T): T {
  if (
    !requestData ||
    typeof requestData !== "object" ||
    Array.isArray(requestData)
  ) {
    return requestData;
  }

  const sanitized: { [key: string]: any } = {};
  Object.keys(requestData as any).forEach((key) => {
    if (key !== "_auth") {
      sanitized[key] = (requestData as any)[key];
    }
  });
  return sanitized as T;
}

function getAuthPayload(
  e: any,
  requestData: any,
  method: "GET" | "POST"
): ProxyAuthPayload {
  if (
    method === "POST" &&
    requestData &&
    typeof requestData === "object" &&
    !Array.isArray(requestData) &&
    requestData._auth
  ) {
    return requestData._auth;
  }

  return {
    uid: e.parameter.uid || e.parameter.firebaseUid,
    timestamp: e.parameter.timestamp,
    signature: e.parameter.signature,
    requestId: e.parameter.requestId,
  };
}

function getQuerySignatureBody(e: any): { [key: string]: any } {
  const sanitized: { [key: string]: any } = {};
  const rawParameters =
    e && e.parameters && typeof e.parameters === "object" ? e.parameters : null;

  if (rawParameters) {
    Object.keys(rawParameters).forEach((key) => {
      if (isAuthQueryParam(key)) {
        return;
      }

      const value = rawParameters[key];
      if (Array.isArray(value)) {
        sanitized[key] = value.map((item) => String(item));
        return;
      }

      if (value !== undefined) {
        sanitized[key] = [String(value)];
      }
    });
    return sanitized;
  }

  const parameters =
    e && e.parameter && typeof e.parameter === "object" ? e.parameter : {};
  Object.keys(parameters).forEach((key) => {
    if (!isAuthQueryParam(key)) {
      sanitized[key] = [String(parameters[key])];
    }
  });
  return sanitized;
}

function isAuthQueryParam(key: string): boolean {
  return Boolean((AUTH_QUERY_PARAM_KEYS as { [key: string]: boolean })[key]);
}

function createRequestSignature(
  secret: string,
  timestamp: string,
  uid: string,
  action: string,
  target: string,
  body: any
): string {
  const payload = [
    timestamp,
    uid,
    action || "",
    target || "",
    stableStringify(body || {}),
  ].join(".");
  const bytes = Utilities.computeHmacSha256Signature(payload, secret);
  return Utilities.base64EncodeWebSafe(bytes);
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return JSON.stringify(value.toISOString());
  }

  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function assertNotReplay(requestId: string): void {
  const normalizedRequestId = normalizeRequiredString(
    requestId,
    "_auth.requestId"
  );
  const cacheKey = `security_request_${sha256Base64(normalizedRequestId)}`;
  const cache = CacheService.getScriptCache();

  if (cache.get(cacheKey)) {
    throw new Error("Duplicate request detected.");
  }

  cache.put(cacheKey, "1", REPLAY_CACHE_TTL_SECONDS);
}

function createRandomCode(): string {
  const raw = Utilities.getUuid().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}`;
}

function createProxySecret(uid: string, setupCodeHash: string): string {
  const seed = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid(),
    uid,
    setupCodeHash,
    String(Date.now()),
    getScriptIdForEntropy(),
  ].join(".");

  return sha256Base64(seed);
}

function getScriptIdForEntropy(): string {
  try {
    return ScriptApp.getScriptId();
  } catch (error) {
    return "script-id-unavailable";
  }
}

function sha256Base64(value: string): string {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value
  );
  return Utilities.base64EncodeWebSafe(bytes);
}

function normalizeRequiredString(value: any, fieldName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`Missing required field: ${fieldName}.`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`Missing required field: ${fieldName}.`);
  }
  return normalized;
}

function clearSetupCode(
  properties: GoogleAppsScript.Properties.Properties
): void {
  properties.deleteProperty(SECURITY_PROP_KEYS.setupCodeHash);
  properties.deleteProperty(SECURITY_PROP_KEYS.setupCodeExpiresAt);
}

function maskValue(value: string): string {
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
