import crypto from "node:crypto";
import keytar from "keytar";

const SERVICE_NAME = "veasly-tracker";
const MASTER_KEY_ACCOUNT = "master-key";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export class VaultKeyMissingError extends Error {
  constructor(message = "마스터 암호화 키를 키체인에서 찾을 수 없습니다.") {
    super(message);
    this.name = "VaultKeyMissingError";
  }
}

export class VaultDecryptError extends Error {
  constructor(
    message = "암호화 데이터 복호화에 실패했습니다. 키가 변경되었거나 데이터가 손상되었을 수 있습니다.",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "VaultDecryptError";
  }
}

let cachedKey: Buffer | null = null;

async function loadMasterKey(): Promise<Buffer | null> {
  if (cachedKey) return cachedKey;

  const existing = await keytar.getPassword(SERVICE_NAME, MASTER_KEY_ACCOUNT);
  if (!existing) return null;

  cachedKey = Buffer.from(existing, "base64");
  return cachedKey;
}

async function createMasterKey(): Promise<Buffer> {
  const key = crypto.randomBytes(KEY_LENGTH);
  await keytar.setPassword(
    SERVICE_NAME,
    MASTER_KEY_ACCOUNT,
    key.toString("base64")
  );
  cachedKey = key;
  return key;
}

/**
 * Returns the master encryption key, creating one if absent.
 * Safe for write paths (encrypt) only; reads must use {@link requireMasterKey}.
 */
async function getOrCreateMasterKey(): Promise<Buffer> {
  const existing = await loadMasterKey();
  if (existing) return existing;
  return createMasterKey();
}

/**
 * Returns the master encryption key, throwing if absent.
 * Use for decrypt() so we never silently mint a fresh key over existing ciphertext.
 */
async function requireMasterKey(): Promise<Buffer> {
  const key = await loadMasterKey();
  if (!key) {
    throw new VaultKeyMissingError();
  }
  return key;
}

export async function encrypt(plainText: string): Promise<EncryptedPayload> {
  const key = await getOrCreateMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
}

export async function decrypt(payload: EncryptedPayload): Promise<string> {
  const key = await requireMasterKey();

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64")
    );

    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

    const plainText = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]);

    return plainText.toString("utf8");
  } catch (error) {
    throw new VaultDecryptError(undefined, error);
  }
}

/**
 * Test helper / explicit teardown. Drops the cached key without touching keytar.
 */
export function clearKeyCache() {
  cachedKey = null;
}
