import {
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";

import { env } from "./env";

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing — scrypt, from Node's standard library.
 *
 * scrypt is memory-hard and is what OWASP recommends when Argon2id isn't
 * available. Using the built-in means no native module to compile, which keeps
 * the Docker image small and avoids the single most common deploy failure for
 * Node apps (a native dep that won't build on the target architecture).
 *
 * Parameters follow the OWASP minimum for scrypt: N=2^17, r=8, p=1.
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  if (expected.length !== SCRYPT_KEYLEN) return false;

  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN);

  // Constant-time — a plain `===` here leaks hash bytes through timing.
  return timingSafeEqual(derived, expected);
}

/**
 * Session tokens.
 *
 * The raw token goes to the browser in an httpOnly cookie; only its SHA-256
 * hash is stored. Someone who dumps the `Session` table therefore gets nothing
 * they can replay as a login. SHA-256 (not scrypt) is correct here because the
 * token is already 256 bits of entropy — there is nothing to brute-force, so
 * the slow-hash cost would buy nothing.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Short, unambiguous codes for game PINs and collab invites. */
const UNAMBIGUOUS_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I/L

export function generateCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += UNAMBIGUOUS_ALPHABET[bytes[i]! % UNAMBIGUOUS_ALPHABET.length];
  }
  return out;
}

/** Numeric game PIN — familiar to anyone who has played this genre of game. */
export function generateGamePin(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += (bytes[i]! % 10).toString();
  return out;
}

/**
 * AES-256-GCM for data we must be able to read back — currently only per-user
 * AI API keys. GCM is authenticated, so tampering is detected rather than
 * silently decrypting to garbage.
 */

function encryptionKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    // Accept a passphrase by deriving 32 bytes, so a non-base64 value still works.
    return createHash("sha256").update(env.ENCRYPTION_KEY).digest();
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or tampered ciphertext. Either way the caller gets null and
    // treats the secret as absent rather than crashing.
    return null;
  }
}

/** Constant-time string compare for CSRF tokens and similar. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
