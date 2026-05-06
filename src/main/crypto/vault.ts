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

async function getOrCreateMasterKey(): Promise<Buffer> {
  const existing = await keytar.getPassword(SERVICE_NAME, MASTER_KEY_ACCOUNT);

  if (existing) {
    return Buffer.from(existing, "base64");
  }

  const key = crypto.randomBytes(KEY_LENGTH);
  await keytar.setPassword(SERVICE_NAME, MASTER_KEY_ACCOUNT, key.toString("base64"));

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
  const key = await getOrCreateMasterKey();
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
}
