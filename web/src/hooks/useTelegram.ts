/**
 * Detects if the current environment is Telegram Mini App
 * by checking URL hash/query parameters that Telegram passes.
 * This works BEFORE the SDK is loaded.
 */
export function isTelegramEnvironment(): boolean {
    if (typeof window === 'undefined') return false

    // Telegram passes launch params via window.location.hash
    // Format: #tgWebAppVersion=...&tgWebAppData=...&tgWebAppPlatform=...
    const hash = window.location.hash.slice(1)
    const hashParams = new URLSearchParams(hash)

    // Primary detection: check hash parameters
    if (hashParams.has('tgWebAppVersion') || hashParams.has('tgWebAppData')) {
        return true
    }

    // Fallback: check query parameters (alternative flow)
    const search = window.location.search
    if (search.includes('tgWebApp') || search.includes('initData')) {
        return true
    }

    return false
}

export type TelegramWebAppThemeParams = {
    bg_color?: string
    text_color?: string
    hint_color?: string
    link_color?: string
    button_color?: string
    button_text_color?: string
    secondary_bg_color?: string
}

export type TelegramWebAppUser = {
    id: number
    username?: string
    first_name: string
    last_name?: string
}

export type TelegramWebAppInitDataUnsafe = {
    start_param?: string
    user?: TelegramWebAppUser
}

export type TelegramWebApp = {
    initData: string
    initDataUnsafe?: TelegramWebAppInitDataUnsafe
    themeParams: TelegramWebAppThemeParams
    colorScheme?: 'light' | 'dark'
    platform?: string
    version?: string
    headerColor?: string
    backgroundColor?: string
    bottomBarColor?: string
    isVersionAtLeast?: (version: string) => boolean
    ready: () => void
    expand: () => void
    disableVerticalSwipes?: () => void
    setHeaderColor?: (color: string) => void
    setBackgroundColor?: (color: string) => void
    setBottomBarColor?: (color: string) => void
    close?: () => void
    onEvent?: (eventType: string, callback: () => void) => void
    offEvent?: (eventType: string, callback: () => void) => void
    BackButton?: {
        show: () => void
        hide: () => void
        onClick: (callback: () => void) => void
        offClick: (callback: () => void) => void
    }
    MainButton?: {
        text: string
        color: string
        textColor: string
        isVisible: boolean
        isActive: boolean
        show: () => void
        hide: () => void
        enable: () => void
        disable: () => void
        setText: (text: string) => void
        onClick: (callback: () => void) => void
        offClick: (callback: () => void) => void
    }
    HapticFeedback?: {
        impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
        notificationOccurred: (type: 'error' | 'success' | 'warning') => void
        selectionChanged: () => void
    }
    SettingsButton?: {
        isVisible: boolean
        show: () => void
        hide: () => void
        onClick: (callback: () => void) => void
        offClick: (callback: () => void) => void
    }
}

let lastHapticFeedbackAt = 0
let removeTelegramInteractionHaptics: (() => void) | null = null

type TelegramChromeMethod = 'setHeaderColor' | 'setBackgroundColor' | 'setBottomBarColor'

type TelegramChromeAttempt = {
    method: TelegramChromeMethod
    candidate: string
    ok: boolean
    error?: string
}

declare global {
    interface Window {
        Telegram?: {
            WebApp?: TelegramWebApp
        }
    }
}

export function getTelegramWebApp(): TelegramWebApp | null {
    return window.Telegram?.WebApp ?? null
}

/**
 * Checks if running inside a real Telegram Mini App.
 * Requires SDK to be loaded. Returns true only if initData is present.
 */
export function isTelegramApp(): boolean {
    const tg = getTelegramWebApp()
    return tg !== null && Boolean(tg.initData)
}

export function configureTelegramWebApp(options: { syncThemeColors?: boolean } = {}): void {
    const tg = getTelegramWebApp()
    if (!tg) {
        reportTelegramChromeSync(null, [], 'no-webapp')
        return
    }

    tg.ready()
    tg.expand()
    tg.disableVerticalSwipes?.()
    if (options.syncThemeColors ?? true) {
        syncTelegramWebAppThemeColors()
    }
    installTelegramInteractionHaptics()
}

export function syncTelegramWebAppThemeColors(color = getResolvedAppBackgroundColor()): void {
    const tg = getTelegramWebApp()
    if (!tg) {
        reportTelegramChromeSync(color, [], 'no-webapp')
        return
    }
    if (!color) {
        reportTelegramChromeSync(null, [], 'no-color')
        return
    }

    const attempts: TelegramChromeAttempt[] = []
    setTelegramHeaderColor(tg, color, attempts)
    setTelegramChromeColor(tg, 'setBackgroundColor', color, ['bg_color'], attempts)
    setTelegramChromeColor(tg, 'setBottomBarColor', color, ['bottom_bar_bg_color', 'bg_color'], attempts)
    reportTelegramChromeSync(color, attempts, 'attempted')
}

function setTelegramHeaderColor(tg: TelegramWebApp, color: string, attempts: TelegramChromeAttempt[]): void {
    if (!tg.setHeaderColor) return

    if (!tg.isVersionAtLeast || tg.isVersionAtLeast('6.9')) {
        if (setTelegramChromeColor(tg, 'setHeaderColor', color, [], attempts)) return
    }

    setTelegramChromeColor(tg, 'setHeaderColor', color, ['bg_color', 'secondary_bg_color'], attempts)
}

function setTelegramChromeColor(
    tg: TelegramWebApp,
    method: TelegramChromeMethod,
    color: string,
    fallbackColors: string[] = [],
    attempts: TelegramChromeAttempt[] = []
): boolean {
    const setter = tg[method]
    if (!setter) return false

    for (const candidate of [color, ...fallbackColors]) {
        try {
            setter.call(tg, candidate)
            attempts.push({ method, candidate, ok: true })
            return true
        } catch (error) {
            attempts.push({
                method,
                candidate,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            })
            // Some Telegram clients reject custom hex colors for specific
            // chrome surfaces. Keep the other surfaces independent.
        }
    }

    return false
}

function reportTelegramChromeSync(
    color: string | null,
    attempts: TelegramChromeAttempt[],
    reason: 'attempted' | 'no-webapp' | 'no-color'
): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const tg = getTelegramWebApp()

    const body = JSON.stringify({
        event: 'telegram-chrome-sync',
        reason,
        color,
        resolvedAppBg: getResolvedAppBackgroundColor(),
        dataTheme: document.documentElement.getAttribute('data-theme'),
        colorTheme: document.documentElement.getAttribute('data-color-theme'),
        telegram: {
            version: tg?.version ?? null,
            platform: tg?.platform ?? null,
            colorScheme: tg?.colorScheme ?? null,
            headerColor: tg?.headerColor ?? null,
            backgroundColor: tg?.backgroundColor ?? null,
            bottomBarColor: tg?.bottomBarColor ?? null,
            hasSetHeaderColor: typeof tg?.setHeaderColor === 'function',
            hasSetBackgroundColor: typeof tg?.setBackgroundColor === 'function',
            hasSetBottomBarColor: typeof tg?.setBottomBarColor === 'function',
        },
        attempts,
    })

    void fetch('/api/debug/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
    }).catch(() => {
        // Debug-only best effort.
    })
}

export function getResolvedAppBackgroundColor(): string | null {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return null

    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.pointerEvents = 'none'
    probe.style.visibility = 'hidden'
    probe.style.backgroundColor = 'var(--app-bg)'

    document.body.appendChild(probe)
    const resolved = window.getComputedStyle(probe).backgroundColor
    probe.remove()

    return normalizeCssColorToHex(resolved)
}

export function normalizeCssColorToHex(color: string): string | null {
    const value = color.trim().toLowerCase()
    if (!value || value === 'transparent') return null

    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
        const raw = hex[1]!
        if (raw.length === 6) return `#${raw}`
        return `#${raw.split('').map((char) => char + char).join('')}`
    }

    const rgb = value.match(/^rgba?\(([^)]+)\)$/)
    if (!rgb) return null

    const channels = rgb[1]!
        .split(',')
        .slice(0, 3)
        .map((part) => Number.parseInt(part.trim(), 10))

    if (channels.length !== 3 || channels.some((channel) => Number.isNaN(channel))) {
        return null
    }

    return `#${channels.map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`
}

function clampColorChannel(channel: number): number {
    return Math.min(255, Math.max(0, channel))
}

export function markTelegramHapticFeedback(): void {
    lastHapticFeedbackAt = Date.now()
}

export function hasRecentTelegramHapticFeedback(windowMs = 120): boolean {
    return Date.now() - lastHapticFeedbackAt < windowMs
}

export function installTelegramInteractionHaptics(): void {
    if (removeTelegramInteractionHaptics || typeof document === 'undefined') return

    const onClick = (event: MouseEvent) => {
        if (!event.isTrusted || hasRecentTelegramHapticFeedback()) return

        const target = event.target
        if (!(target instanceof Element)) return

        const interactive = target.closest<HTMLElement>(
            'button, a[href], select, summary, input[type="checkbox"], input[type="radio"], input[type="range"], [role="button"], [role="menuitem"], [role="option"], [data-haptic]'
        )
        if (!interactive || isDisabledInteractiveElement(interactive)) return

        const feedback = getTelegramWebApp()?.HapticFeedback
        if (!feedback) return

        markTelegramHapticFeedback()
        if (isSelectionInteractiveElement(interactive)) {
            feedback.selectionChanged()
            return
        }
        feedback.impactOccurred('light')
    }

    document.addEventListener('click', onClick)
    removeTelegramInteractionHaptics = () => {
        document.removeEventListener('click', onClick)
        removeTelegramInteractionHaptics = null
    }
}

function isDisabledInteractiveElement(element: HTMLElement): boolean {
    if (element.getAttribute('aria-disabled') === 'true') return true
    if (
        element instanceof HTMLButtonElement
        || element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
    ) {
        return element.disabled
    }
    return false
}

function isSelectionInteractiveElement(element: HTMLElement): boolean {
    if (element instanceof HTMLSelectElement) return true
    if (element instanceof HTMLInputElement) {
        return element.type === 'checkbox' || element.type === 'radio'
    }
    const role = element.getAttribute('role')
    return role === 'option' || role === 'menuitemradio' || role === 'menuitemcheckbox'
}

/**
 * Dynamically loads the Telegram Web App SDK with timeout.
 * Only call this if isTelegramEnvironment() returns true.
 */
export function loadTelegramSdk(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
        if (window.Telegram?.WebApp) {
            resolve()
            return
        }

        let settled = false
        let timedOut = false
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        const settle = () => {
            if (!settled) {
                settled = true
                if (timeoutId !== null) {
                    clearTimeout(timeoutId)
                }
                resolve()
            }
        }

        // Timeout - don't block app indefinitely
        timeoutId = setTimeout(() => {
            timedOut = true
            settle()
        }, timeoutMs)

        const script = document.createElement('script')
        script.src = 'https://telegram.org/js/telegram-web-app.js'
        script.async = true
        script.onload = () => {
            if (timedOut) {
                configureTelegramWebApp()
            }
            settle()
        }
        script.onerror = settle
        document.head.appendChild(script)
    })
}
