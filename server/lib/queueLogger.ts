import fs from 'fs'
import path from 'path'
import { db } from './Database.js'
import sql from 'sqlate'

const LOG_DIR = path.join(process.cwd(), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'queue.log')

function ensureDir (): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function getQueueSnapshot (roomId: number): string {
  const query = sql`
    SELECT q.queueId, q.userId, q.position, s.title, u.name AS username
    FROM queue q
    JOIN songs s ON s.songId = q.songId
    JOIN users u ON u.userId = q.userId
    WHERE q.roomId = ${roomId}
    ORDER BY q.position ASC
  `
  const rows = db.all<{ queueId: number, userId: number, position: string, title: string, username: string }>(
    String(query), query.parameters
  )

  if (rows.length === 0) return '  (queue vide)'

  return rows.map((r, i) =>
    `  ${String(i + 1).padStart(2)}. [${r.position.padEnd(6)}] qId=${r.queueId} "${r.title}" (${r.username})`
  ).join('\n')
}

export function logQueueAction (
  action: string,
  userId: number,
  roomId: number,
  details: string
): void {
  try {
    ensureDir()
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '')
    const snapshot = getQueueSnapshot(roomId)
    const entry = `[${ts}] ${action} | userId=${userId} | ${details}\n${snapshot}\n\n`
    fs.appendFileSync(LOG_FILE, entry, 'utf8')
  } catch (err) {
    // Ne pas laisser les erreurs de log crasher le serveur
    console.error('[queueLogger] erreur:', err)
  }
}
