import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { buildPost } from './posts'
import type { Post, PostSource } from './types'

/**
 * The encrypted wrapper is intentionally small: only the file name and a generic
 * label remain visible in the repository. The complete frontmatter and body are
 * encrypted on the client before a GitHub commit is created.
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
const PLACEHOLDER_TITLE = '加密文章'
const PLACEHOLDER_CONTENT = '本文内容已加密。请输入密码后查看。'

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

  // Do not include the original title, tags, summary or date in the wrapper.
  return stringifyFrontmatter(
    {
      title: PLACEHOLDER_TITLE,
      // Keep a valid but non-identifying date so the public article index can
      // still sort the opaque wrapper without exposing its real metadata.
      date: '1970-01-01',
      encrypted: true,
      encryption: JSON.stringify(envelope),
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
    const iv = base64ToBytes(envelope.iv)
    const ciphertext = base64ToBytes(envelope.ciphertext)
    const key = await deriveKey(password, salt, envelope.iterations)
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
  } catch (error) {
    if (error instanceof Error && /文章加密数据|不支持的文章|当前浏览器/.test(error.message)) throw error
    throw new Error('密码不正确，或文章内容已损坏')
  }
}

/** Used for remote history files before a Post instance exists. */
export function isEncryptedMarkdown(raw: string): boolean {
  const { data } = parseFrontmatter(raw)
  return data.encrypted === true || data.encrypted === 'true'
}
