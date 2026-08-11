import {
    backButton,
    hapticFeedback,
    init as initTma,
    initData,
    isTMA,
    miniApp,
    retrieveLaunchParams,
    retrieveRawInitData,
    swipeBehavior,
    themeParams,
    viewport,
} from '@tma.js/sdk'

const TELEGRAM_DEBUG_BUILD_ID = 'tma-sdk-debug-bafb5056-20260811'
const TMA_INIT_RETRY_DELAY_MS = 500

/**
 * Detects if the current environment is Telegram Mini App
 * by checking URL hash/query parameters that Telegram passes.
 * This works BEFORE the SDK is loaded.
 */
export function isTelegramEnvironment(): boolean {
    if (typeof window === 'undefined') return false

    if (window.Telegram?.WebApp) return true
    if (isTmaEnvironment()) return true

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

    return hasTelegramHostBridge() || isTelegramUserAgent()
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
let tmaInitialized = false
let tmaInitAttempted = false
let tmaInitAttemptCount = 0
let tmaInitError: string | null = null
let lastTmaInitAttemptAt = 0
let tmaCleanup: (() => void) | null = null

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
        TelegramGameProxy?: unknown
        TelegramWebviewProxy?: unknown
        TelegramWebviewProxyProto?: unknown
    }
}

export function getTelegramWebApp(): TelegramWebApp | null {
    const nativeWebApp = window.Telegram?.WebApp
    if (nativeWebApp) return nativeWebApp

    if (!initializeTmaSdk()) return null
    const rawInitData = safeRead(() => retrieveRawInitData()) ?? ''
    const launchParams = safeRead(() => retrieveLaunchParams())

    return {
        initData: rawInitData,
        initDataUnsafe: {
            start_param: initData.startParam() ?? launchParams?.tgWebAppStartParam,
            user: normalizeTelegramUser(initData.user()),
        },
        themeParams: normalizeTelegramThemeParams(themeParams.state()),
        colorScheme: themeParams.isDark() ? 'dark' : 'light',
        platform: launchParams?.tgWebAppPlatform,
        version: launchParams?.tgWebAppVersion,
        headerColor: String(miniApp.headerColor()),
        backgroundColor: String(miniApp.bgColor()),
        bottomBarColor: String(miniApp.bottomBarColor()),
        isVersionAtLeast: (version) => compareVersions(launchParams?.tgWebAppVersion ?? '0', version) >= 0,
        ready: () => miniApp.ready.ifAvailable(),
        expand: () => viewport.expand.ifAvailable(),
        disableVerticalSwipes: () => swipeBehavior.disableVertical.ifAvailable(),
        setHeaderColor: (color) => setTmaChromeColor('setHeaderColor', color),
        setBackgroundColor: (color) => setTmaChromeColor('setBackgroundColor', color),
        setBottomBarColor: (color) => setTmaChromeColor('setBottomBarColor', color),
        close: () => miniApp.close.ifAvailable(),
        BackButton: {
            show: () => backButton.show.ifAvailable(),
            hide: () => backButton.hide.ifAvailable(),
            onClick: (callback) => {
                backButton.onClick.ifAvailable(callback)
            },
            offClick: (callback) => {
                backButton.offClick.ifAvailable(callback)
            },
        },
        HapticFeedback: {
            impactOccurred: (style) => hapticFeedback.impactOccurred.ifAvailable(style),
            notificationOccurred: (type) => hapticFeedback.notificationOccurred.ifAvailable(type),
            selectionChanged: () => hapticFeedback.selectionChanged.ifAvailable(),
        },
    }
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
        buildId: TELEGRAM_DEBUG_BUILD_ID,
        reason,
        color,
        resolvedAppBg: getResolvedAppBackgroundColor(),
        dataTheme: document.documentElement.getAttribute('data-theme'),
        colorTheme: document.documentElement.getAttribute('data-color-theme'),
        environment: getTelegramEnvironmentSnapshot(),
        tma: getTmaSnapshot(),
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

function reportTelegramDebug(event: string, extra: Record<string, unknown> = {}): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const body = JSON.stringify({
        event,
        buildId: TELEGRAM_DEBUG_BUILD_ID,
        dataTheme: document.documentElement.getAttribute('data-theme'),
        colorTheme: document.documentElement.getAttribute('data-color-theme'),
        resolvedAppBg: getResolvedAppBackgroundColor(),
        environment: getTelegramEnvironmentSnapshot(),
        tma: getTmaSnapshot(),
        ...extra,
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

function getTelegramEnvironmentSnapshot() {
    const script = document.head.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]')
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const searchParams = new URLSearchParams(window.location.search)

    return {
        detected: isTelegramEnvironment(),
        telegramAppDataset: document.documentElement.dataset.telegramApp ?? null,
        hashKeys: Array.from(hashParams.keys()).filter((key) => key.startsWith('tgWebApp')),
        searchKeys: Array.from(searchParams.keys()).filter((key) => key.includes('tg') || key.includes('initData')),
        hasTelegramLaunchParams: hasTelegramLaunchParams(),
        hasTelegramUserAgent: isTelegramUserAgent(),
        hasTelegramHostBridge: hasTelegramHostBridge(),
        hasWindowTelegram: Boolean(window.Telegram),
        hasWindowTelegramWebApp: Boolean(window.Telegram?.WebApp),
        sdkScriptPresent: Boolean(script),
        tmaInitialized,
        tmaInitAttempted,
        tmaInitAttemptCount,
        tmaInitError,
        locationHashLength: window.location.hash.length,
        locationSearchLength: window.location.search.length,
    }
}

function getTmaSnapshot(): Record<string, string | number | boolean | null> {
    const launchParams = safeRead(() => retrieveLaunchParams())
    return {
        buildId: TELEGRAM_DEBUG_BUILD_ID,
        initialized: tmaInitialized,
        initAttempted: tmaInitAttempted,
        initAttemptCount: tmaInitAttemptCount,
        initError: tmaInitError,
        hasRawInitData: Boolean(safeRead(() => retrieveRawInitData())),
        launchVersion: launchParams?.tgWebAppVersion ?? null,
        launchPlatform: launchParams?.tgWebAppPlatform ?? null,
        miniAppMounted: safeRead(() => miniApp.isMounted()) ?? false,
        themeParamsMounted: safeRead(() => themeParams.isMounted()) ?? false,
        viewportMounted: safeRead(() => viewport.isMounted()) ?? false,
        swipeBehaviorMounted: safeRead(() => swipeBehavior.isMounted()) ?? false,
        backButtonMounted: safeRead(() => backButton.isMounted()) ?? false,
        readyAvailable: safeRead(() => miniApp.ready.isAvailable()) ?? false,
        expandAvailable: safeRead(() => viewport.expand.isAvailable()) ?? false,
        headerColorAvailable: safeRead(() => miniApp.setHeaderColor.isAvailable()) ?? false,
        headerColorRgbSupported: safeRead(() => miniApp.setHeaderColor.supports('rgb')) ?? false,
        bgColorAvailable: safeRead(() => miniApp.setBgColor.isAvailable()) ?? false,
        bottomBarColorAvailable: safeRead(() => miniApp.setBottomBarColor.isAvailable()) ?? false,
        swipeDisableAvailable: safeRead(() => swipeBehavior.disableVertical.isAvailable()) ?? false,
        hapticImpactAvailable: safeRead(() => hapticFeedback.impactOccurred.isAvailable()) ?? false,
    }
}

function hasTelegramLaunchParams(): boolean {
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    if (hashParams.has('tgWebAppVersion') || hashParams.has('tgWebAppData')) return true
    return window.location.search.includes('tgWebApp') || window.location.search.includes('initData')
}

function isTelegramUserAgent(): boolean {
    return typeof navigator !== 'undefined' && /\bTelegram\b/i.test(navigator.userAgent)
}

function hasTelegramHostBridge(): boolean {
    const hostWindow = window as Window & { external?: { notify?: unknown } }
    return Boolean(
        window.TelegramWebviewProxy
        || window.TelegramWebviewProxyProto
        || window.TelegramGameProxy
        || hostWindow.external?.notify
    )
}

function isTmaEnvironment(): boolean {
    try {
        return isTMA()
    } catch {
        return false
    }
}

function initializeTmaSdk(): boolean {
    if (typeof window === 'undefined') return false
    if (tmaInitialized) return true
    const now = Date.now()
    if (tmaInitAttempted && now - lastTmaInitAttemptAt < TMA_INIT_RETRY_DELAY_MS) return false

    tmaInitAttempted = true
    tmaInitAttemptCount += 1
    lastTmaInitAttemptAt = now
    reportTelegramDebug('telegram-tma-init', { stage: 'start' })
    try {
        tmaCleanup = initTma()
        tmaInitialized = true
        tmaInitError = null
    } catch (error) {
        tmaInitError = error instanceof Error ? error.message : String(error)
        reportTelegramDebug('telegram-tma-init', {
            stage: 'failed',
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: tmaInitError,
        })
        return false
    }

    safeCall(() => initData.restore())
    safeCall(() => {
        if (!themeParams.isMounted()) themeParams.mount()
    })
    safeCall(() => {
        if (!miniApp.isMounted()) miniApp.mount()
    })
    safeCall(() => {
        if (!viewport.isMounted()) viewport.mount()
    })
    safeCall(() => {
        if (!swipeBehavior.isMounted()) swipeBehavior.mount()
    })
    safeCall(() => {
        if (!backButton.isMounted()) backButton.mount()
    })

    reportTelegramDebug('telegram-tma-init', { stage: 'mounted' })
    return true
}

function normalizeTelegramUser(user: ReturnType<typeof initData.user>): TelegramWebAppUser | undefined {
    if (!user) return undefined
    return {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
    }
}

function normalizeTelegramThemeParams(params: ReturnType<typeof themeParams.state>): TelegramWebAppThemeParams {
    return {
        bg_color: params.bgColor,
        text_color: params.textColor,
        hint_color: params.hintColor,
        link_color: params.linkColor,
        button_color: params.buttonColor,
        button_text_color: params.buttonTextColor,
        secondary_bg_color: params.secondaryBgColor,
    }
}

function setTmaChromeColor(method: TelegramChromeMethod, color: string): void {
    if (method === 'setHeaderColor') {
        if (miniApp.setHeaderColor.isAvailable()) {
            if (miniApp.setHeaderColor.supports('rgb')) {
                miniApp.setHeaderColor(color)
                return
            }
            miniApp.setHeaderColor('bg_color')
        }
        return
    }

    if (method === 'setBackgroundColor') {
        miniApp.setBgColor.ifAvailable(color)
        return
    }

    miniApp.setBottomBarColor.ifAvailable(color)
}

function safeCall(callback: () => void): void {
    try {
        callback()
    } catch {
        // Telegram features are version/platform dependent.
    }
}

function safeRead<T>(callback: () => T): T | null {
    try {
        return callback()
    } catch {
        return null
    }
}

function compareVersions(a: string, b: string): number {
    const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
    const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
        const delta = (left[index] ?? 0) - (right[index] ?? 0)
        if (delta !== 0) return delta
    }
    return 0
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
 * Initializes the Telegram Mini Apps SDK. Kept async for the existing bootstrap contract.
 */
export function loadTelegramSdk(timeoutMs = 3000): Promise<void> {
    void timeoutMs
    initializeTmaSdk()
    return Promise.resolve()
}
