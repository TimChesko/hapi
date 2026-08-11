import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'

const telegramChromeAttemptSchema = z.object({
    method: z.string().max(32),
    candidate: z.string().max(64),
    ok: z.boolean(),
    error: z.string().max(200).optional(),
})

const telegramDebugValueSchema = z.union([
    z.string().max(500),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).max(30),
])

const telegramDebugSchema = z.object({
    event: z.string().max(80),
    buildId: z.string().max(80).optional(),
    reason: z.enum(['attempted', 'no-webapp', 'no-color']).optional(),
    color: z.string().max(64).nullable().optional(),
    resolvedAppBg: z.string().max(64).nullable().optional(),
    dataTheme: z.string().max(32).nullable().optional(),
    colorTheme: z.string().max(32).nullable().optional(),
    stage: z.string().max(80).optional(),
    environment: z.record(z.string(), telegramDebugValueSchema).optional(),
    tma: z.record(z.string(), telegramDebugValueSchema).optional(),
    telegram: z.object({
        version: z.string().max(32).nullable(),
        platform: z.string().max(32).nullable(),
        colorScheme: z.string().max(16).nullable(),
        headerColor: z.string().max(64).nullable(),
        backgroundColor: z.string().max(64).nullable(),
        bottomBarColor: z.string().max(64).nullable(),
        hasSetHeaderColor: z.boolean(),
        hasSetBackgroundColor: z.boolean(),
        hasSetBottomBarColor: z.boolean(),
    }).optional(),
    attempts: z.array(telegramChromeAttemptSchema).max(12).optional(),
}).passthrough()

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

        const parsed = telegramDebugSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        console.info('[telegram-debug]', JSON.stringify({
            ...parsed.data,
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
