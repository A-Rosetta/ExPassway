const encoder = new TextEncoder();

export class WebAuthnError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "WebAuthnError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) {
  throw new WebAuthnError(code, message, status);
}

function decodeBase64Url(value, field) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail("INVALID_WEBAUTHN_CREDENTIAL", `${field} is not valid base64url.`);
  }
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_error) {
    fail("INVALID_WEBAUTHN_CREDENTIAL", `${field} is not valid base64url.`);
  }
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function utf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_error) {
    fail("INVALID_WEBAUTHN_CLIENT_DATA", "WebAuthn client data is not valid UTF-8.");
  }
}

function readLength(data, state, additional) {
  if (additional < 24) return additional;
  const width =
    additional === 24
      ? 1
      : additional === 25
        ? 2
        : additional === 26
          ? 4
          : additional === 27
            ? 8
            : 0;
  if (!width || state.offset + width > data.length)
    fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR value is truncated.");
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + data[state.offset + index];
  state.offset += width;
  if (!Number.isSafeInteger(value))
    fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR length is too large.");
  return value;
}

// WebAuthn attestation objects and COSE keys use a small, definite-length
// CBOR subset. Keeping this parser local avoids a Node-only dependency in the
// Cloudflare Worker bundle.
function decodeCborValue(data, state, depth = 0) {
  if (depth > 16 || state.offset >= data.length)
    fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR value is invalid.");
  const initial = data[state.offset++];
  const major = initial >> 5;
  const additional = initial & 0x1f;
  if (additional === 31)
    fail("INVALID_WEBAUTHN_ATTESTATION", "Indefinite-length CBOR is not supported.");
  if (major === 0 || major === 1) {
    const value = readLength(data, state, additional);
    return major === 0 ? value : -1 - value;
  }
  if (major === 2 || major === 3) {
    const length = readLength(data, state, additional);
    if (length > 2 * 1024 * 1024 || state.offset + length > data.length)
      fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR byte string is invalid.");
    const value = data.slice(state.offset, state.offset + length);
    state.offset += length;
    return major === 2 ? value : utf8(value);
  }
  if (major === 4) {
    const length = readLength(data, state, additional);
    if (length > 128) fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR array is too large.");
    const values = [];
    for (let index = 0; index < length; index += 1)
      values.push(decodeCborValue(data, state, depth + 1));
    return values;
  }
  if (major === 5) {
    const length = readLength(data, state, additional);
    if (length > 128) fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR map is too large.");
    const values = new Map();
    for (let index = 0; index < length; index += 1) {
      const key = decodeCborValue(data, state, depth + 1);
      if ((typeof key !== "string" && typeof key !== "number") || values.has(key))
        fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR map key is invalid or duplicated.");
      values.set(key, decodeCborValue(data, state, depth + 1));
    }
    return values;
  }
  if (major === 6) {
    readLength(data, state, additional);
    return decodeCborValue(data, state, depth + 1);
  }
  if (major === 7) {
    if (additional === 20) return false;
    if (additional === 21) return true;
    if (additional === 22 || additional === 23) return null;
    if (additional === 24) {
      if (state.offset >= data.length)
        fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR value is truncated.");
      return data[state.offset++];
    }
    if (additional === 25) {
      if (state.offset + 2 > data.length)
        fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR float is truncated.");
      state.offset += 2;
      return 0;
    }
    if (additional === 26) {
      if (state.offset + 4 > data.length)
        fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR float is truncated.");
      const value = new DataView(data.buffer, data.byteOffset + state.offset, 4).getFloat32(0);
      state.offset += 4;
      return value;
    }
    if (additional === 27) {
      if (state.offset + 8 > data.length)
        fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR float is truncated.");
      const value = new DataView(data.buffer, data.byteOffset + state.offset, 8).getFloat64(0);
      state.offset += 8;
      return value;
    }
  }
  fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR value is unsupported.");
}

function decodeCbor(data) {
  const state = { offset: 0 };
  const value = decodeCborValue(data, state);
  if (state.offset !== data.length)
    fail("INVALID_WEBAUTHN_ATTESTATION", "The WebAuthn CBOR object has trailing data.");
  return value;
}

function parseAuthenticatorData(data, registration) {
  if (data.length < 37)
    fail("INVALID_WEBAUTHN_AUTHENTICATOR_DATA", "The WebAuthn authenticator data is too short.");
  const flags = data[32];
  if (!(flags & 0x01) || !(flags & 0x04))
    fail("USER_VERIFICATION_REQUIRED", "WebAuthn user verification is required.");
  const signCount = (data[33] * 0x1000000 + (data[34] << 16) + (data[35] << 8) + data[36]) >>> 0;
  const result = {
    rpIdHash: data.slice(0, 32),
    flags,
    signCount,
    // WebAuthn L3 BE/BS bits (backup eligible/currently backed up).
    backupEligible: Boolean(flags & 0x08),
    backupState: Boolean(flags & 0x10),
  };
  if (!registration) {
    if (flags & 0x40)
      fail("INVALID_WEBAUTHN_AUTHENTICATOR_DATA", "Assertions cannot contain attested credential data.");
    const extensionState = { offset: 37 };
    if (flags & 0x80 && !(decodeCborValue(data, extensionState) instanceof Map))
      fail("INVALID_WEBAUTHN_AUTHENTICATOR_DATA", "Authenticator extensions must be a CBOR map.");
    if (extensionState.offset !== data.length)
      fail("INVALID_WEBAUTHN_AUTHENTICATOR_DATA", "Authenticator data has trailing bytes.");
    return result;
  }
  if (!(flags & 0x40))
    fail("INVALID_WEBAUTHN_ATTESTATION", "The registration response has no credential data.");
  let offset = 37;
  if (offset + 18 > data.length)
    fail("INVALID_WEBAUTHN_ATTESTATION", "The credential data is truncated.");
  result.aaguid = data.slice(offset, offset + 16);
  offset += 16;
  const credentialLength = (data[offset] << 8) | data[offset + 1];
  offset += 2;
  if (!credentialLength || offset + credentialLength > data.length)
    fail("INVALID_WEBAUTHN_ATTESTATION", "The credential identifier is invalid.");
  result.credentialId = data.slice(offset, offset + credentialLength);
  offset += credentialLength;
  const keyState = { offset };
  result.coseKey = decodeCborValue(data, keyState);
  if (flags & 0x80 && !(decodeCborValue(data, keyState) instanceof Map))
    fail("INVALID_WEBAUTHN_ATTESTATION", "Authenticator extensions must be a CBOR map.");
  if (keyState.offset !== data.length)
    fail("INVALID_WEBAUTHN_ATTESTATION", "The credential data has trailing bytes.");
  return result;
}

function coseToJwk(cose) {
  if (!(cose instanceof Map) || cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) {
    fail("UNSUPPORTED_WEBAUTHN_KEY", "Only ES256 WebAuthn credentials are supported.");
  }
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.length !== 32 ||
    y.length !== 32
  ) {
    fail("INVALID_WEBAUTHN_KEY", "The WebAuthn ES256 public key is invalid.");
  }
  return { kty: "EC", crv: "P-256", x: base64Url(x), y: base64Url(y), ext: true };
}

function derToP1363(signature) {
  if (signature.length === 64) return signature;
  if (signature.length < 8 || signature[0] !== 0x30)
    fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature is invalid.");
  let offset = 1;
  let length = signature[offset++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (!count || count > 2 || offset + count > signature.length)
      fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature length is invalid.");
    length = 0;
    for (let index = 0; index < count; index += 1) length = (length << 8) | signature[offset++];
  }
  if (offset + length !== signature.length || signature[offset++] !== 0x02)
    fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature is invalid.");
  const rLength = signature[offset++];
  if (rLength & 0x80)
    fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature integer is invalid.");
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (offset >= signature.length || signature[offset++] !== 0x02)
    fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature is invalid.");
  const sLength = signature[offset++];
  if (sLength & 0x80 || offset + sLength !== signature.length)
    fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature integer is invalid.");
  const s = signature.slice(offset, offset + sLength);
  if (!r.length || !s.length || r[0] & 0x80 || s[0] & 0x80 ||
      r.length > 33 || s.length > 33 || (r.length === 33 && r[0] !== 0) ||
      (s.length === 33 && s[0] !== 0))
    fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature integer is invalid.");
  const output = new Uint8Array(64);
  output.set(r.slice(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
  output.set(s.slice(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));
  return output;
}

function parseClientData(value, expectedType, challenge) {
  const bytes = decodeBase64Url(value, "clientDataJSON");
  let parsed;
  try {
    parsed = JSON.parse(utf8(bytes));
  } catch (_error) {
    fail("INVALID_WEBAUTHN_CLIENT_DATA", "The WebAuthn client data JSON is invalid.");
  }
  if (parsed?.type !== expectedType)
    fail("INVALID_WEBAUTHN_CLIENT_DATA", "The WebAuthn client data type is invalid.");
  if (parsed.crossOrigin === true || parsed.topOrigin)
    fail("INVALID_WEBAUTHN_ORIGIN", "Embedded cross-origin WebAuthn ceremonies are not allowed.");
  const expectedChallenge = decodeBase64Url(challenge, "challenge");
  let actualChallenge;
  try {
    actualChallenge = decodeBase64Url(parsed.challenge, "clientData.challenge");
  } catch (_error) {
    fail("INVALID_WEBAUTHN_CLIENT_DATA", "The WebAuthn client data challenge is invalid.");
  }
  if (!equalBytes(expectedChallenge, actualChallenge))
    fail("INVALID_WEBAUTHN_CHALLENGE", "The WebAuthn client data challenge does not match.");
  return { bytes, parsed };
}

async function checkRpId(authenticatorData, rpId) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(rpId)));
  if (!equalBytes(authenticatorData.rpIdHash, digest))
    fail("INVALID_WEBAUTHN_RP_ID", "The WebAuthn RP ID hash does not match.");
}

function allowedOrigins(env, requestOrigin) {
  const configured = String(env.CHAT_WEBAUTHN_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : [requestOrigin];
}

export function webAuthnContext(request, env) {
  const requestUrl = new URL(request.url);
  const rpId = String(env.CHAT_WEBAUTHN_RP_ID || requestUrl.hostname)
    .trim()
    .toLowerCase();
  const origin = String(env.CHAT_WEBAUTHN_ORIGIN || requestUrl.origin)
    .split(",")[0]
    .trim();
  if (!rpId || !origin)
    fail("WEBAUTHN_CONFIGURATION_ERROR", "WebAuthn RP ID and origin are not configured.", 500);
  return { rpId, origin, origins: allowedOrigins(env, requestUrl.origin) };
}

export async function verifyRegistrationResponse({ credential, challenge, rpId, origins }) {
  const response = credential?.response || {};
  const clientData = parseClientData(response.clientDataJSON, "webauthn.create", challenge);
  if (!origins.includes(clientData.parsed.origin))
    fail("INVALID_WEBAUTHN_ORIGIN", "The WebAuthn origin does not match.");
  const attestationBytes = decodeBase64Url(response.attestationObject, "attestationObject");
  const attestation = decodeCbor(attestationBytes);
  if (
    !(attestation instanceof Map) ||
    attestation.get("fmt") !== "none" ||
    !(attestation.get("attStmt") instanceof Map) || attestation.get("attStmt").size !== 0 ||
    !(attestation.get("authData") instanceof Uint8Array)
  ) {
    fail(
      "UNSUPPORTED_WEBAUTHN_ATTESTATION",
      "Only WebAuthn fmt:none registration responses are supported."
    );
  }
  const authenticatorData = parseAuthenticatorData(attestation.get("authData"), true);
  await checkRpId(authenticatorData, rpId);
  const credentialId = base64Url(authenticatorData.credentialId);
  const publicKey = coseToJwk(authenticatorData.coseKey);
  return {
    credentialId,
    publicKey,
    signCount: authenticatorData.signCount,
    backupEligible: authenticatorData.backupEligible,
    backupState: authenticatorData.backupState,
    clientExtensionResults: credential.clientExtensionResults || {},
  };
}

export async function verifyAuthenticationResponse({
  credential,
  challenge,
  rpId,
  origins,
  publicKey,
  expectedSignCount,
}) {
  const response = credential?.response || {};
  const clientData = parseClientData(response.clientDataJSON, "webauthn.get", challenge);
  if (!origins.includes(clientData.parsed.origin))
    fail("INVALID_WEBAUTHN_ORIGIN", "The WebAuthn origin does not match.");
  const authenticatorDataBytes = decodeBase64Url(response.authenticatorData, "authenticatorData");
  const authenticatorData = parseAuthenticatorData(authenticatorDataBytes, false);
  await checkRpId(authenticatorData, rpId);
  if (expectedSignCount > 0 && authenticatorData.signCount > 0 && authenticatorData.signCount <= expectedSignCount) {
    fail("WEBAUTHN_CLONED_CREDENTIAL", "The WebAuthn signature counter did not increase.", 401);
  }
  let jwk;
  try {
    jwk = JSON.parse(publicKey);
  } catch (_error) {
    fail("INVALID_WEBAUTHN_KEY", "The stored WebAuthn public key is invalid.");
  }
  let key;
  try {
    key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
  } catch (_error) {
    fail("INVALID_WEBAUTHN_KEY", "The stored WebAuthn public key is invalid.");
  }
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData.bytes));
  const signedData = new Uint8Array(authenticatorDataBytes.length + clientDataHash.length);
  signedData.set(authenticatorDataBytes);
  signedData.set(clientDataHash, authenticatorDataBytes.length);
  const signature = derToP1363(decodeBase64Url(response.signature, "signature"));
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signedData
    );
  } catch (_error) {
    valid = false;
  }
  if (!valid) fail("INVALID_WEBAUTHN_SIGNATURE", "The WebAuthn signature is invalid.", 401);
  return {
    signCount: authenticatorData.signCount,
    backupEligible: authenticatorData.backupEligible,
    backupState: authenticatorData.backupState,
    clientExtensionResults: credential.clientExtensionResults || {},
  };
}
