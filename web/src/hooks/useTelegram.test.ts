import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureTelegramWebApp, loadTelegramSdk, normalizeCssColorToHex, syncTelegramWebAppThemeColors } from './useTelegram'

afterEach(() => {
    delete window.Telegram
    delete window.TelegramWebviewProxy
    document.head.querySelectorAll('script[src="https://telegram.org/js/telegram-web-app.js"]').forEach((script) => script.remove())
    vi.useRealTimers()
})

describe('configureTelegramWebApp', () => {
    it('marks Telegram Mini App ready, expands it, and disables vertical swipe close', () => {
        const ready = vi.fn()
        const expand = vi.fn()
        const disableVerticalSwipes = vi.fn()
        const setHeaderColor = vi.fn()
        const setBackgroundColor = vi.fn()
        const setBottomBarColor = vi.fn()

        window.Telegram = {
            WebApp: {
                initData: 'init-data',
                themeParams: {},
                ready,
                expand,
                disableVerticalSwipes,
                setHeaderColor,
                setBackgroundColor,
                setBottomBarColor,
            },
        }

        configureTelegramWebApp()

        expect(ready).toHaveBeenCalledOnce()
        expect(expand).toHaveBeenCalledOnce()
        expect(disableVerticalSwipes).toHaveBeenCalledOnce()
    })

    it('does nothing when the Telegram SDK is unavailable', () => {
        expect(() => configureTelegramWebApp()).not.toThrow()
    })

    it('supports older Telegram clients without vertical swipe controls', () => {
        const ready = vi.fn()
        const expand = vi.fn()

        window.Telegram = {
            WebApp: {
                initData: 'init-data',
                themeParams: {},
                ready,
                expand,
            },
        }

        configureTelegramWebApp()

        expect(ready).toHaveBeenCalledOnce()
        expect(expand).toHaveBeenCalledOnce()
    })

    it('syncs app background color to Telegram chrome', () => {
        const setHeaderColor = vi.fn()
        const setBackgroundColor = vi.fn()
        const setBottomBarColor = vi.fn()

        window.Telegram = {
            WebApp: {
                initData: 'init-data',
                themeParams: {},
                ready: vi.fn(),
                expand: vi.fn(),
                setHeaderColor,
                setBackgroundColor,
                setBottomBarColor,
            },
        }

        syncTelegramWebAppThemeColors('#123abc')

        expect(setHeaderColor).toHaveBeenCalledWith('#123abc')
        expect(setBackgroundColor).toHaveBeenCalledWith('#123abc')
        expect(setBottomBarColor).toHaveBeenCalledWith('#123abc')
    })

    it('falls back to raw Telegram bridge events when WebApp SDK is unavailable', () => {
        const postEvent = vi.fn()
        window.TelegramWebviewProxy = { postEvent }

        syncTelegramWebAppThemeColors('#123abc')

        expect(postEvent).toHaveBeenCalledWith('web_app_set_header_color', JSON.stringify({ color: '#123abc' }))
        expect(postEvent).toHaveBeenCalledWith('web_app_set_background_color', JSON.stringify({ color: '#123abc' }))
        expect(postEvent).toHaveBeenCalledWith('web_app_set_bottom_bar_color', JSON.stringify({ color: '#123abc' }))
    })

    it('keeps syncing other Telegram chrome surfaces when one setter rejects a color', () => {
        const setHeaderColor = vi.fn(() => {
            throw new Error('unsupported color')
        })
        const setBackgroundColor = vi.fn()
        const setBottomBarColor = vi.fn()

        window.Telegram = {
            WebApp: {
                initData: 'init-data',
                themeParams: {},
                ready: vi.fn(),
                expand: vi.fn(),
                setHeaderColor,
                setBackgroundColor,
                setBottomBarColor,
            },
        }

        syncTelegramWebAppThemeColors('#1f271d')

        expect(setBackgroundColor).toHaveBeenCalledWith('#1f271d')
        expect(setBottomBarColor).toHaveBeenCalledWith('#1f271d')
    })

    it('calls Telegram chrome setters with the WebApp receiver', () => {
        const receivers: unknown[] = []
        const webApp = {
            initData: 'init-data',
            themeParams: {},
            ready: vi.fn(),
            expand: vi.fn(),
            setHeaderColor(this: unknown) {
                receivers.push(this)
            },
            setBackgroundColor(this: unknown) {
                receivers.push(this)
            },
            setBottomBarColor(this: unknown) {
                receivers.push(this)
            },
        }
        window.Telegram = { WebApp: webApp }

        syncTelegramWebAppThemeColors('#1f271d')

        expect(receivers).toEqual([webApp, webApp, webApp])
    })

    it('can defer Telegram chrome color sync until the app theme is applied', () => {
        const setHeaderColor = vi.fn()
        const setBackgroundColor = vi.fn()
        const setBottomBarColor = vi.fn()

        window.Telegram = {
            WebApp: {
                initData: 'init-data',
                themeParams: {},
                ready: vi.fn(),
                expand: vi.fn(),
                setHeaderColor,
                setBackgroundColor,
                setBottomBarColor,
            },
        }

        configureTelegramWebApp({ syncThemeColors: false })

        expect(setHeaderColor).not.toHaveBeenCalled()
        expect(setBackgroundColor).not.toHaveBeenCalled()
        expect(setBottomBarColor).not.toHaveBeenCalled()
    })

    it('normalizes CSS color values for Telegram APIs', () => {
        expect(normalizeCssColorToHex('#abc')).toBe('#aabbcc')
        expect(normalizeCssColorToHex('rgb(18, 58, 188)')).toBe('#123abc')
        expect(normalizeCssColorToHex('rgba(300, -1, 16, 0.5)')).toBe('#ff0010')
        expect(normalizeCssColorToHex('transparent')).toBeNull()
    })

    it('initializes without injecting the legacy Telegram script', async () => {
        await loadTelegramSdk()

        const script = document.head.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]')
        expect(script).toBeNull()
    })

    it('does not emit haptics for programmatic clicks', () => {
        const impactOccurred = vi.fn()
        window.Telegram = {
            WebApp: {
                initData: 'init-data',
                themeParams: {},
                ready: vi.fn(),
                expand: vi.fn(),
                HapticFeedback: {
                    impactOccurred,
                    notificationOccurred: vi.fn(),
                    selectionChanged: vi.fn(),
                },
            },
        }
        const button = document.createElement('button')
        document.body.appendChild(button)

        configureTelegramWebApp()
        button.click()

        expect(impactOccurred).not.toHaveBeenCalled()
        button.remove()
    })
})
