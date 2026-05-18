import crypto from 'crypto';
import { config } from '../config';

const KEY = (() => {
  const buf = Buffer.from(config.encryptionKey, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be a 32-byte key, base64-encoded (generate with `openssl rand -base64 32`)'
    );
  }
  return buf;
})();

export interface EncryptedField {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
}

export function encrypt(plaintext: string): EncryptedField {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decrypt(field: EncryptedField): string {
  const iv = Buffer.from(field.iv, 'base64');
  const tag = Buffer.from(field.tag, 'base64');
  const ct = Buffer.from(field.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as EncryptedField).ciphertext === 'string' &&
    typeof (value as EncryptedField).iv === 'string' &&
    typeof (value as EncryptedField).tag === 'string'
  );
}
