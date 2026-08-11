import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'

export function createTelegramDebugRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/debug/telegram', async (c) => {
        const raw = await c.req.text().catch(() => '')
        if (raw.length > 8_192) {
            return c.json({ error: 'Payload too large' }, 413)
        }

        let json: unknown
        try {
            json = JSON.parse(raw)
        } catch {
            return c.json({ error: 'Invalid JSON' }, 400)
        }

        if (!json || typeof json !== 'object' || Array.isArray(json)) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        console.info('[telegram-debug]', JSON.stringify({
            ...sanitizeDebugRecord(json),
            request: {
                userAgent: c.req.header('user-agent') ?? null,
                forwardedFor: c.req.header('x-forwarded-for') ?? null,
                realIp: c.req.header('x-real-ip') ?? null,
            },
        }))
        return c.json({ ok: true })
    })

    return app
}

function sanitizeDebugRecord(value: object): Record<string, unknown> {
    return sanitizeDebugValue(value, 0) as Record<string, unknown>
}

function sanitizeDebugValue(value: unknown, depth: number): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
    if (typeof value === 'string') return value.slice(0, 1_000)
    if (depth >= 4) return '[truncated]'

    if (Array.isArray(value)) {
        return value.slice(0, 30).map((item) => sanitizeDebugValue(item, depth + 1))
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 60)
                .map(([key, item]) => [key.slice(0, 80), sanitizeDebugValue(item, depth + 1)])
        )
    }

    return String(value)
}
