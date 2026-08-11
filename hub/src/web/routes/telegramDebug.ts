import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'

const telegramChromeAttemptSchema = z.object({
    method: z.string().max(32),
    candidate: z.string().max(64),
    ok: z.boolean(),
    error: z.string().max(200).optional(),
})

const telegramDebugSchema = z.object({
    event: z.literal('telegram-chrome-sync'),
    color: z.string().max(64).nullable(),
    resolvedAppBg: z.string().max(64).nullable(),
    dataTheme: z.string().max(32).nullable(),
    colorTheme: z.string().max(32).nullable(),
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
    }),
    attempts: z.array(telegramChromeAttemptSchema).max(12),
})

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

        console.info('[telegram-debug]', JSON.stringify(parsed.data))
        return c.json({ ok: true })
    })

    return app
}
