import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import {
  countUsers,
  createSession,
  createUser,
  deleteSession,
  deleteSessionsForUser,
  findUserByName,
  getUserById,
  purgeExpiredSessions,
  touchSession,
  updateUserPassword,
} from './db.js'

/**
 * Session authentication for a self-hosted single-tenant deployment.
 *
 * Passwords are stored as scrypt hashes with a per-user salt; session tokens
 * are random 256-bit values and only their SHA-256 digest is persisted, so a
 * copy of the database cannot be replayed as a live session.
 */

const SESSION_COOKIE = 'vh_session'
const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 86_400_000
const SCRYPT_KEYLEN = 64

/* ------------------------------ passwords ------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  // constant-time: a length mismatch would make timingSafeEqual throw
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Minimum viable policy — long enough to resist offline guessing. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters.'
  }
  if (password.length > 200) return 'Password must be at most 200 characters.'
  return null
}

export function usernameProblem(username: string): string | null {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return 'Username must be 3-40 characters (letters, digits, dot, dash, underscore).'
  }
  return null
}

/* ------------------------------- sessions ------------------------------- */

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/** True when the request reached us over TLS, directly or via a proxy. */
function isSecure(req: Request): boolean {
  return req.secure || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https'
}

export function issueSession(req: Request, res: Response, userId: string): void {
  const token = randomBytes(32).toString('base64url')
  createSession(tokenDigest(token), userId, new Date(Date.now() + SESSION_MS).toISOString())
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // unreachable from JavaScript, so XSS cannot exfiltrate it
    sameSite: 'lax', // blocks the cookie on cross-site POSTs — CSRF protection
    secure: isSecure(req),
    maxAge: SESSION_MS,
    path: '/',
  })
}

export function clearSession(req: Request, res: Response): void {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) deleteSession(tokenDigest(token))
  res.clearCookie(SESSION_COOKIE, {
    path: '/',
    sameSite: 'lax',
    secure: isSecure(req),
    httpOnly: true,
  })
}

export interface AuthUser {
  id: string
  username: string
}

/** Resolve the caller from the session cookie, sliding the expiry forward. */
export function currentUser(req: Request): AuthUser | null {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const session = touchSession(tokenDigest(token), new Date(Date.now() + SESSION_MS).toISOString())
  if (!session) return null
  const user = getUserById(session.userId)
  return user ? { id: user.id, username: user.username } : null
}

/** Whether an account exists yet — drives the first-run setup screen. */
export function isConfigured(): boolean {
  return countUsers() > 0
}

/* --------------------------- login throttling --------------------------- */

const MAX_FAILURES = 8
const LOCKOUT_MS = 15 * 60_000
const attempts = new Map<string, { count: number; until: number }>()

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

export function lockoutRemainingMs(req: Request): number {
  const key = clientKey(req)
  const entry = attempts.get(key)
  if (!entry || entry.count < MAX_FAILURES) return 0
  const remaining = entry.until - Date.now()
  if (remaining <= 0) {
    attempts.delete(key)
    return 0
  }
  return remaining
}

export function recordFailure(req: Request): void {
  const key = clientKey(req)
  const entry = attempts.get(key) ?? { count: 0, until: 0 }
  entry.count += 1
  entry.until = Date.now() + LOCKOUT_MS
  attempts.set(key, entry)
}

export function clearFailures(req: Request): void {
  attempts.delete(clientKey(req))
}

/* ------------------------------ middleware ------------------------------ */

/**
 * Endpoints reachable without a session. The middleware is mounted at '/api',
 * so req.path here is relative to that prefix — '/auth/login', not
 * '/api/auth/login'.
 */
const PUBLIC_PATHS = new Set(['/health', '/auth/status', '/auth/setup', '/auth/login', '/auth/logout'])

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path
  if (PUBLIC_PATHS.has(path)) {
    next()
    return
  }
  if (currentUser(req)) {
    next()
    return
  }
  res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' })
}

/* ------------------------------- accounts ------------------------------- */

export function setupFirstUser(username: string, password: string): AuthUser {
  if (isConfigured()) {
    throw Object.assign(new Error('An account already exists.'), { code: 'ALREADY_CONFIGURED' })
  }
  const id = `u_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  createUser(id, username, hashPassword(password))
  return { id, username }
}

export function authenticate(username: string, password: string): AuthUser | null {
  const user = findUserByName(username)
  if (!user) {
    // spend comparable time on unknown users so timing cannot enumerate them
    scryptSync(password, 'no-such-user', SCRYPT_KEYLEN)
    return null
  }
  if (!verifyPassword(password, user.passwordHash)) return null
  return { id: user.id, username: user.username }
}

/** Change the password and drop every existing session (including this one). */
export function changePassword(userId: string, current: string, next: string): string | null {
  const user = getUserById(userId)
  if (!user || !verifyPassword(current, user.passwordHash)) return 'Current password is incorrect.'
  const problem = passwordProblem(next)
  if (problem) return problem
  updateUserPassword(userId, hashPassword(next))
  deleteSessionsForUser(userId)
  return null
}

/** Housekeeping: drop expired sessions on startup and hourly thereafter. */
export function startSessionCleanup(): void {
  purgeExpiredSessions()
  setInterval(() => purgeExpiredSessions(), 3_600_000).unref()
}
