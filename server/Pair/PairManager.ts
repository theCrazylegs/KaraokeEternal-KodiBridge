import getLogger from '../lib/Log.js'
import crypto from 'node:crypto'

const log = getLogger('pair')

const CODE_LENGTH = 4
const CODE_TTL = 300_000 // 5 minutes
const CLEANUP_INTERVAL = 60_000 // 1 minute

interface PairSession {
  pairId: string
  code: string
  createdAt: number
  // set when an authenticated user confirms the code
  token: string | null
}

const sessions = new Map<string, PairSession>()

// index code → pairId for fast lookup during confirm
const codeIndex = new Map<string, string>()

// periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now()

  for (const [pairId, session] of sessions) {
    if (now - session.createdAt > CODE_TTL) {
      codeIndex.delete(session.code)
      sessions.delete(pairId)
    }
  }
}, CLEANUP_INTERVAL)

function generateCode (): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid confusion
  let code: string

  do {
    code = Array.from(crypto.randomBytes(CODE_LENGTH))
      .map(b => chars[b % chars.length])
      .join('')
  } while (codeIndex.has(code)) // ensure uniqueness

  return code
}

function create (): { pairId: string; code: string } {
  const pairId = crypto.randomUUID()
  const code = generateCode()

  const session: PairSession = {
    pairId,
    code,
    createdAt: Date.now(),
    token: null,
  }

  sessions.set(pairId, session)
  codeIndex.set(code, pairId)

  log.verbose('created pair session %s (code: %s)', pairId, code)

  return { pairId, code }
}

function confirm (code: string, token: string): boolean {
  const pairId = codeIndex.get(code.toUpperCase())

  if (!pairId) return false

  const session = sessions.get(pairId)

  if (!session) return false

  // check expiry
  if (Date.now() - session.createdAt > CODE_TTL) {
    codeIndex.delete(session.code)
    sessions.delete(pairId)
    return false
  }

  // already confirmed?
  if (session.token) return false

  session.token = token

  log.verbose('pair session %s confirmed', pairId)

  return true
}

function getStatus (pairId: string): { status: string; token?: string } {
  const session = sessions.get(pairId)

  if (!session) {
    return { status: 'expired' }
  }

  // check expiry
  if (Date.now() - session.createdAt > CODE_TTL) {
    codeIndex.delete(session.code)
    sessions.delete(pairId)
    return { status: 'expired' }
  }

  if (session.token) {
    // consume the session once token is retrieved
    const token = session.token
    codeIndex.delete(session.code)
    sessions.delete(pairId)

    return { status: 'confirmed', token }
  }

  return { status: 'pending' }
}

export default { create, confirm, getStatus }
