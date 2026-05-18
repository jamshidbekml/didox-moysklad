import { Schema, model } from 'mongoose';

/**
 * Encrypted blob stored in MongoDB for sensitive fields (AES-256-GCM).
 * See src/utils/crypto.ts for encrypt/decrypt.
 */
const encryptedFieldSchema = new Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
  },
  { _id: false }
);

const subscriptionSchema = new Schema(
  {
    tariffId: { type: String, required: true },
    trial: { type: Boolean, required: true },
    tariffName: String,
    expiryMoment: String,
    notForResale: { type: Boolean, required: true },
    partner: { type: Boolean, required: true },
  },
  { _id: false }
);

const settingsSchema = new Schema(
  {
    didoxTin: String,
    didoxPassword: encryptedFieldSchema, // ENCRYPTED at rest
    autoSendDemand: { type: Boolean, default: false },
    configured: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    appUid: { type: String, required: true },
    accountName: { type: String, required: true },
    status: {
      type: String,
      enum: ['Activating', 'SettingsRequired', 'Activated', 'Deactivated'],
      required: true,
    },
    accessToken: encryptedFieldSchema, // ENCRYPTED at rest
    subscription: subscriptionSchema,
    settings: { type: settingsSchema, default: () => ({}) },
    installedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    timestamps: { createdAt: false, updatedAt: 'updatedAt' },
    collection: 'users',
  }
);

export const UserModel = model('User', userSchema);
