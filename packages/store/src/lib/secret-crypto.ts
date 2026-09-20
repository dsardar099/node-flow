import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Envelope encryption for secret values.
 *
 * Every value gets its **own** data key, which is itself encrypted by a master
 * key and stored beside the ciphertext. That indirection is what makes the two
 * operations anyone actually needs cheap:
 *
 *  - **Rotating the master key** re-encrypts one small data key per secret
 *    rather than every secret value, so rotation is an operation rather than a
 *    project — and a rotation that is expensive is a rotation nobody performs.
 *  - **A compromised data key** exposes exactly one secret. A single key
 *    encrypting everything makes every leak total.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a value edited in the
 * database fails to decrypt rather than decrypting to something else. That
 * matters more here than confidentiality alone — an attacker who can write to
 * the database but not read the master key must not be able to substitute a
 * connection string of their choosing.
 */

/** Bumped when the wire format changes, so old rows stay readable. */
const FORMAT = 1;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedSecret {
  /** Format marker, so a future change can be migrated rather than guessed. */
  format: number;
  /** Which master key sealed the data key. Lets rotation be incremental. */
  keyId: string;
  /** The data key, encrypted by the master key. Base64. */
  wrappedKey: string;
  /** The value, encrypted by the data key. Base64. */
  ciphertext: string;
}

export interface MasterKey {
  id: string;
  /** 32 bytes. Held in memory only. */
  material: Buffer;
}

/**
 * The master keys an install holds.
 *
 * A list rather than one, because rotation needs the old key to still decrypt
 * while the new key encrypts. The first entry is the one that seals; the rest
 * exist only to open what they sealed earlier.
 */
export class SecretCipher {
  private readonly byId: Map<string, MasterKey>;
  private readonly active: MasterKey;

  constructor(keys: MasterKey[]) {
    if (keys.length === 0) {
      throw new Error('at least one master key is required to store secrets');
    }

    for (const key of keys) {
      if (key.material.length !== KEY_BYTES) {
        throw new Error(`master key "${key.id}" must be ${KEY_BYTES} bytes`);
      }
    }

    this.active = keys[0];
    this.byId = new Map(keys.map((key) => [key.id, key]));
  }

  get activeKeyId(): string {
    return this.active.id;
  }

  /**
   * Seals a value.
   *
   * `namespaceId` and `name` are bound in as additional authenticated data, so
   * a ciphertext cannot be moved: copying one tenant's row into another
   * tenant's namespace, or renaming `staging-db-password` to `prod-db-password`,
   * produces a value that will not decrypt rather than one that silently works.
   */
  seal(plaintext: string, namespaceId: string, name: string): SealedSecret {
    const dataKey = randomBytes(KEY_BYTES);

    const ciphertext = encrypt(dataKey, Buffer.from(plaintext, 'utf8'), aad(namespaceId, name));
    const wrappedKey = encrypt(this.wrapKey(this.active), dataKey, Buffer.from(this.active.id));

    // Wiped as soon as it is wrapped. It still exists in whatever buffers the
    // cipher allocated, so this is hygiene rather than a guarantee — but a data
    // key sitting in a long-lived object is a needless one.
    dataKey.fill(0);

    return {
      format: FORMAT,
      keyId: this.active.id,
      wrappedKey: wrappedKey.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  open(sealed: SealedSecret, namespaceId: string, name: string): string {
    if (sealed.format !== FORMAT) {
      throw new Error(`secret was written in format ${sealed.format}, which this build cannot read`);
    }

    const master = this.byId.get(sealed.keyId);
    if (!master) {
      // Naming the key is safe and saves an afternoon: the alternative message
      // is "unable to decrypt", which sends people looking for corruption.
      throw new Error(
        `secret was sealed with master key "${sealed.keyId}", which is not configured`
      );
    }

    const dataKey = decrypt(
      this.wrapKey(master),
      Buffer.from(sealed.wrappedKey, 'base64'),
      Buffer.from(master.id)
    );

    try {
      return decrypt(
        dataKey,
        Buffer.from(sealed.ciphertext, 'base64'),
        aad(namespaceId, name)
      ).toString('utf8');
    } finally {
      dataKey.fill(0);
    }
  }

  /** Whether a sealed value would be re-sealed by a rotation. */
  needsRotation(sealed: SealedSecret): boolean {
    return sealed.keyId !== this.active.id || sealed.format !== FORMAT;
  }

  /**
   * Derives the key-wrapping key from the master key.
   *
   * HKDF rather than using the master key directly, so the key that wraps data
   * keys is not the same bytes as anything else the master key is ever used
   * for. Cheap, and it removes a whole class of cross-protocol mistake.
   */
  private wrapKey(master: MasterKey): Buffer {
    return Buffer.from(hkdfSync('sha256', master.material, Buffer.alloc(0), 'node-flow:secret-wrap', KEY_BYTES));
  }
}

/**
 * Binds a ciphertext to where it lives.
 *
 * Without this, a row is portable: whoever can write to the database can move a
 * sealed value between namespaces or rename it onto a more valuable key, and it
 * decrypts perfectly.
 */
function aad(namespaceId: string, name: string): Buffer {
  return Buffer.from(`${namespaceId}:${name}`, 'utf8');
}

/** `iv | tag | ciphertext`, so one buffer carries everything needed to open it. */
function encrypt(key: Buffer, plaintext: Buffer, additional: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additional);

  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, sealed: Buffer, additional: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) {
    throw new Error('sealed value is truncated');
  }

  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(additional);
  decipher.setAuthTag(tag);

  // Throws on a tag mismatch, which is the authentication working.
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Reads master keys from configuration.
 *
 * Accepts `id:base64key` entries, newest first. Two keys are what a rotation
 * looks like in flight: the new one seals, the old one still opens.
 */
export function parseMasterKeys(raw: string): MasterKey[] {
  const keys: MasterKey[] = [];

  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator === -1) {
      throw new Error('each master key must be written as "id:base64key"');
    }

    const id = entry.slice(0, separator);
    const material = Buffer.from(entry.slice(separator + 1), 'base64');

    if (!id) throw new Error('a master key needs an id');
    if (material.length !== KEY_BYTES) {
      throw new Error(`master key "${id}" must decode to ${KEY_BYTES} bytes`);
    }
    if (keys.some((key) => key.id === id)) {
      throw new Error(`master key id "${id}" appears twice`);
    }

    keys.push({ id, material });
  }

  return keys;
}

/** Constant-time comparison, for anything that compares a secret to input. */
export function secretEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
