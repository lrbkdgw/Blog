import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { buildPost } from './posts'
import type { Post, PostSource } from './types'

/**
 * The encrypted wrapper keeps the article title public so readers can identify it.
 * All remaining frontmatter and the body are encrypted in the browser before a
 * GitHub commit is created.
 */
export interface ArticleEncryptionEnvelope {
  version: 1
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

const ITERATIONS = 310_000
const PLACEHOLDER_CONTENT = '本文内容已加密。请输入密码后查看。'
const UNLOCK_DB_NAME = 'starlog:protected-posts'
const UNLOCK_STORE_NAME = 'unlock-keys'
const UNLOCK_DB_VERSION = 1

interface StoredUnlockKey {
  id: string
  key: CryptoKey
  savedAt: number
}

let unlockDbPromise: Promise<IDBDatabase> | null = null

function openUnlockDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('当前浏览器不支持保存解锁状态'))
  if (unlockDbPromise) return unlockDbPromise
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(UNLOCK_DB_NAME, UNLOCK_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(UNLOCK_STORE_NAME)) {
        database.createObjectStore(UNLOCK_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        unlockDbPromise = null
      }
      resolve(database)
    }
    request.onerror = () => reject(request.error || new Error('无法打开文章解锁状态存储'))
    request.onblocked = () => reject(new Error('文章解锁状态存储正在被其他页面占用'))
  })
  unlockDbPromise = pending.catch((error) => {
    unlockDbPromise = null
    throw error
  })
  return unlockDbPromise
}

async function unlockKeyId(post: Pick<Post, 'slug' | 'encryption'>): Promise<string> {
  if (!post.encryption) throw new Error('文章没有加密数据')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${post.slug}\u0000${post.encryption}`),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readStoredUnlockKey(post: Pick<Post, 'slug' | 'encryption'>): Promise<CryptoKey | null> {
  const database = await openUnlockDatabase()
  const id = await unlockKeyId(post)
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(UNLOCK_STORE_NAME, 'readonly')
      .objectStore(UNLOCK_STORE_NAME)
      .get(id)
    request.onsuccess = () => {
      const record = request.result as StoredUnlockKey | undefined
      resolve(record?.key || null)
    }
    request.onerror = () => reject(request.error || new Error('无法读取文章解锁状态'))
  })
}

async function storeUnlockKey(
  post: Pick<Post, 'slug' | 'encryption'>,
  key: CryptoKey,
): Promise<void> {
  const database = await openUnlockDatabase()
  const record: StoredUnlockKey = {
    id: await unlockKeyId(post),
    key,
    savedAt: Date.now(),
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(UNLOCK_STORE_NAME, 'readwrite')
    transaction.objectStore(UNLOCK_STORE_NAME).put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('无法保存文章解锁状态'))
    transaction.onabort = () => reject(transaction.error || new Error('保存文章解锁状态时事务中止'))
  })
}

async function removeStoredUnlockKey(post: Pick<Post, 'slug' | 'encryption'>): Promise<void> {
  const database = await openUnlockDatabase()
  const id = await unlockKeyId(post)
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(UNLOCK_STORE_NAME, 'readwrite')
    transaction.objectStore(UNLOCK_STORE_NAME).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('无法删除文章解锁状态'))
    transaction.onabort = () => reject(transaction.error || new Error('删除文章解锁状态时事务中止'))
  })
}

export async function clearRememberedPostUnlocks(): Promise<void> {
  if (!globalThis.indexedDB) return
  const database = await openUnlockDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(UNLOCK_STORE_NAME, 'readwrite')
    transaction.objectStore(UNLOCK_STORE_NAME).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('无法清除文章解锁状态'))
    transaction.onabort = () => reject(transaction.error || new Error('清除文章解锁状态时事务中止'))
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function deriveKey(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function assertPassword(password: string) {
  if (password.length < 1) throw new Error('请输入文章密码')
  if (password.length > 1024) throw new Error('密码长度不正确')
}

export function isEncryptedPost(post: Pick<Post, 'encryption'>): boolean {
  return Boolean(post.encryption)
}

/** Encrypt a complete normal Markdown article. The password is never persisted. */
export async function encryptPostMarkdown(post: Post, password: string): Promise<string> {
  assertPassword(password)
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 Web Crypto，无法加密文章')

  const plaintext = serializePlainPost(post)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    new TextEncoder().encode(plaintext),
  )
  const envelope: ArticleEncryptionEnvelope = {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }

  const encryption = JSON.stringify(envelope)
  // Persist only the non-extractable CryptoKey. The password and plaintext are
  // never written to browser storage. Failure to cache must not block publishing.
  await storeUnlockKey({ slug: post.slug, encryption }, key).catch(() => undefined)

  // Keep the requested public title, but do not expose tags, summary or real date.
  return stringifyFrontmatter(
    {
      title: post.title,
      // Keep a valid but non-identifying date so the public article index can
      // still sort the opaque wrapper without exposing its real metadata.
      date: '1970-01-01',
      encrypted: true,
      encryption,
    },
    PLACEHOLDER_CONTENT,
  )
}

function serializePlainPost(post: Post): string {
  return stringifyFrontmatter(
    {
      title: post.title,
      date: post.date,
      updated: post.updated,
      summary: post.summary,
      tags: post.tags,
      cover: post.cover,
      draft: post.draft || undefined,
      pinned: post.pinned || undefined,
      author: post.author,
    },
    post.content,
  )
}

function readEnvelope(value: unknown): ArticleEncryptionEnvelope {
  if (typeof value !== 'string') throw new Error('文章加密数据不完整')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('文章加密数据格式无效')
  }
  const envelope = parsed as Partial<ArticleEncryptionEnvelope>
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'AES-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA-256' ||
    typeof envelope.iterations !== 'number' ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 2_000_000 ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('不支持的文章加密格式')
  }
  return envelope as ArticleEncryptionEnvelope
}

async function decryptPostWithKey(
  post: Post,
  envelope: ArticleEncryptionEnvelope,
  key: CryptoKey,
): Promise<Post> {
  const iv = base64ToBytes(envelope.iv)
  const ciphertext = base64ToBytes(envelope.ciphertext)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  )
  const decrypted = new TextDecoder().decode(raw)
  const rebuilt = buildPost(decrypted, {
    slug: post.slug,
    path: post.path,
    source: post.source as PostSource,
    savedAt: post.savedAt,
  })
  // The returned object is intentionally plain. The encrypted wrapper stays in
  // the caller's source post; carrying it here would make an already-unlocked
  // article look locked to renderers and could accidentally re-publish stale data.
  return rebuilt
}

/**
 * Decrypt an imported protected post and rebuild the ordinary Post shape.
 * Authentication failures deliberately have one generic message so passwords
 * are not exposed through error details.
 */
export async function decryptPost(post: Post, password: string): Promise<Post> {
  assertPassword(password)
  if (!post.encryption) return post
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 Web Crypto，无法解密文章')

  try {
    const envelope = readEnvelope(post.encryption)
    const salt = base64ToBytes(envelope.salt)
    const key = await deriveKey(password, salt, envelope.iterations)
    const rebuilt = await decryptPostWithKey(post, envelope, key)
    // CryptoKey is non-extractable and is stored by the browser through
    // IndexedDB. The password and decrypted article are never persisted.
    await storeUnlockKey(post, key).catch(() => undefined)
    return rebuilt
  } catch (error) {
    if (error instanceof Error && /文章加密数据|不支持的文章|当前浏览器/.test(error.message)) throw error
    throw new Error('密码不正确，或文章内容已损坏')
  }
}

/**
 * Restore an article previously unlocked on this browser. Invalid or stale keys
 * are discarded and callers can fall back to the password prompt.
 */
export async function restorePostUnlock(post: Post): Promise<Post | null> {
  if (!post.encryption) return post
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) return null
  let key: CryptoKey | null = null
  try {
    key = await readStoredUnlockKey(post)
    if (!key) return null
    const envelope = readEnvelope(post.encryption)
    return await decryptPostWithKey(post, envelope, key)
  } catch {
    if (key) await removeStoredUnlockKey(post).catch(() => undefined)
    return null
  }
}

/** Used for remote history files before a Post instance exists. */
export function isEncryptedMarkdown(raw: string): boolean {
  const { data } = parseFrontmatter(raw)
  return data.encrypted === true || data.encrypted === 'true'
}
