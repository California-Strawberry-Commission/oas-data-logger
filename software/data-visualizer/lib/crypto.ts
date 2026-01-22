import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Key must be 32 bytes (64 hex characters)
const ALGORITHM = "aes-256-gcm";

// Lazily load secret
function getSecretKey(): Buffer {
  const secretKey = Buffer.from(
    process.env.DEVICE_SECRET_ENCRYPTION_KEY || "",
    "hex"
  );
  return secretKey;
}

/**
 * Encrypts a raw device secret using AES-256-GCM.
 *
 * This function generates a random Initialization Vector (IV) and computes
 * an Authentication Tag (AuthTag) to ensure data integrity.
 *
 * @param {string} text - The raw plaintext secret (e.g., the 32-byte key generated during provisioning).
 * @returns {string} A colon-separated string containing the IV, AuthTag, and Encrypted Data (e.g., "iv:tag:ciphertext").
 * Store this entire string in the database.
 */

export function encryptSecret(text: string) {
  const secretKey = getSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, secretKey, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts the stored secret back into plaintext.
 *
 * This function parses the packed string, extracts the IV and AuthTag,
 * and uses the server's master key to decrypt the secret.
 *
 * @param {string} packedSecret - The colon-separated string stored in the DB ("iv:tag:ciphertext").
 * @returns {string} The original raw plaintext secret.
 * @throws {Error} If the format is invalid or if decryption fails (e.g., AuthTag mismatch).
 */

export function decryptSecret(packedSecret: string) {
  const secretKey = getSecretKey();
  const [ivHex, authTagHex, encryptedHex] = packedSecret.split(":");

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Invalid secret format: Expected iv:authTag:encrypted");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    secretKey,
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
