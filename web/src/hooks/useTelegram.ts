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

const TELEGRAM_DEBUG_BUILD_ID = 'tma-viewport-debug-20260811'
const APP_VIEWPORT_HEIGHT_REFRESH_EVENT = 'hapi-viewport-height-refresh'
const TMA_INIT_RETRY_DELAY_MS = 500
const TMA_FALLBACK_VERSION = '9.0'
const TELEGRAM_DEBUG_PAGE_ID = createTelegramDebugPageId()

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
let tmaViewportCssVarsCleanup: (() => void) | null = null

type TelegramAppChromeMethod =
    | 'setHeaderColor'
    | 'setBackgroundColor'
    | 'setBottomBarColor'

type TelegramBridgeMethod =
    | 'web_app_set_header_color'
    | 'web_app_set_background_color'
    | 'web_app_set_bottom_bar_color'
    | 'web_app_ready'
    | 'web_app_expand'
    | 'web_app_setup_swipe_behavior'

type TelegramChromeAttempt = {
    method: TelegramAppChromeMethod | TelegramBridgeMethod
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
        TelegramWebviewProxy?: {
            postEvent?: (eventType: string, eventData: string) => void
        }
        TelegramWebviewProxyProto?: unknown
    }
}

export function getTelegramWebApp(): TelegramWebApp | null {
    const nativeWebApp = window.Telegram?.WebApp
    if (nativeWebApp) return nativeWebApp

    if (!isTelegramEnvironment()) return null
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
        const attempts = configureTelegramChromeViaBridge()
        reportTelegramChromeSync(null, attempts, attempts.length > 0 ? 'attempted' : 'no-webapp')
        if (attempts.length > 0 && (options.syncThemeColors ?? true)) {
            syncTelegramWebAppThemeColors()
            installTelegramInteractionHaptics()
        }
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
    if (!color) {
        reportTelegramChromeSync(null, [], 'no-color')
        return
    }

    const attempts: TelegramChromeAttempt[] = []
    if (tg) {
        setTelegramHeaderColor(tg, color, attempts)
        setTelegramChromeColor(tg, 'setBackgroundColor', color, ['bg_color'], attempts)
        setTelegramChromeColor(tg, 'setBottomBarColor', color, ['bottom_bar_bg_color', 'bg_color'], attempts)
    } else {
        syncTelegramChromeColorsViaBridge(color, attempts)
    }
    scheduleViewportHeightRefresh('chrome-sync')
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
    method: TelegramAppChromeMethod,
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

    const tg = getCurrentTelegramWebAppForDebug()

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
    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined

    return {
        debugPageId: TELEGRAM_DEBUG_PAGE_ID,
        detected: isTelegramEnvironment(),
        telegramAppDataset: document.documentElement.dataset.telegramApp ?? null,
        pathname: window.location.pathname,
        visibilityState: document.visibilityState,
        readyState: document.readyState,
        navigationType: navigationEntry?.type ?? null,
        userAgent: navigator.userAgent,
        hashKeys: Array.from(hashParams.keys()).filter((key) => key.startsWith('tgWebApp')),
        searchKeys: Array.from(searchParams.keys()).filter((key) => key.includes('tg') || key.includes('initData')),
        hasTelegramLaunchParams: hasTelegramLaunchParams(),
        hasTelegramUserAgent: isTelegramUserAgent(),
        hasTelegramHostBridge: hasTelegramHostBridge(),
        telegramHostBridge: getTelegramHostBridgeSnapshot(),
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

function createTelegramDebugPageId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getTmaSnapshot(): Record<string, unknown> {
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
        viewportCssVarsBound: safeRead(() => viewport.isCssVarsBound()) ?? false,
        viewportHeight: safeRead(() => viewport.height()) ?? null,
        viewportStableHeight: safeRead(() => viewport.stableHeight()) ?? null,
        cssAppViewportHeight: getRootCssVar('--app-viewport-height'),
        cssTgViewportHeight: getRootCssVar('--tg-viewport-height'),
        cssTgViewportStableHeight: getRootCssVar('--tg-viewport-stable-height'),
        visualViewportHeight: window.visualViewport?.height ?? null,
        visualViewportWidth: window.visualViewport?.width ?? null,
        visualViewportOffsetTop: window.visualViewport?.offsetTop ?? null,
        windowInnerHeight: window.innerHeight,
        documentGeometry: getDocumentGeometrySnapshot(),
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

function getTelegramHostBridgeSnapshot(): Record<string, boolean> {
    const hostWindow = window as Window & { external?: { notify?: unknown } }
    return {
        hasTelegramWebviewProxy: Boolean(window.TelegramWebviewProxy),
        hasTelegramWebviewProxyPostEvent: typeof window.TelegramWebviewProxy?.postEvent === 'function',
        hasTelegramWebviewProxyProto: Boolean(window.TelegramWebviewProxyProto),
        hasTelegramGameProxy: Boolean(window.TelegramGameProxy),
        hasExternalNotify: typeof hostWindow.external?.notify === 'function',
    }
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
        if (!initializeTmaSdkWithoutLaunchParams(error)) {
            reportTelegramDebug('telegram-tma-init', {
                stage: 'failed',
                errorName: error instanceof Error ? error.name : typeof error,
                errorMessage: tmaInitError,
            })
            return false
        }
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
    scheduleTmaViewportCssVarsBind('mounted')
    safeCall(() => {
        if (!swipeBehavior.isMounted()) swipeBehavior.mount()
    })
    safeCall(() => {
        if (!backButton.isMounted()) backButton.mount()
    })

    reportTelegramDebug('telegram-tma-init', { stage: 'mounted' })
    return true
}

function scheduleTmaViewportCssVarsBind(stage: string): void {
    bindTmaViewportCssVars(stage)
    window.setTimeout(() => bindTmaViewportCssVars(`${stage}:next-tick`), 0)
    window.setTimeout(() => {
        bindTmaViewportCssVars(`${stage}:settled`)
        reportTelegramDebug('telegram-viewport-state', { stage: `${stage}:settled` })
    }, 250)
}

function bindTmaViewportCssVars(stage: string): void {
    if (tmaViewportCssVarsCleanup || safeRead(() => viewport.isCssVarsBound()) === true) return

    try {
        const cleanup = viewport.bindCssVars()
        tmaViewportCssVarsCleanup = cleanup
        reportTelegramDebug('telegram-viewport-css-vars', { stage, status: 'bound' })
    } catch (error) {
        reportTelegramDebug('telegram-viewport-css-vars', {
            stage,
            status: 'failed',
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
        })
    }
}

function initializeTmaSdkWithoutLaunchParams(cause: unknown): boolean {
    if (!hasTelegramHostBridge()) return false

    try {
        tmaCleanup = initTma({
            version: TMA_FALLBACK_VERSION,
            themeParams: {},
        })
        tmaInitialized = true
        tmaInitError = null
        reportTelegramDebug('telegram-tma-init', {
            stage: 'fallback',
            fallbackVersion: TMA_FALLBACK_VERSION,
            errorName: cause instanceof Error ? cause.name : typeof cause,
            errorMessage: cause instanceof Error ? cause.message : String(cause),
        })
        return true
    } catch (error) {
        tmaInitError = error instanceof Error ? error.message : String(error)
        reportTelegramDebug('telegram-tma-init', {
            stage: 'fallback-failed',
            fallbackVersion: TMA_FALLBACK_VERSION,
            hostBridge: getTelegramHostBridgeSnapshot(),
            causeName: cause instanceof Error ? cause.name : typeof cause,
            causeMessage: cause instanceof Error ? cause.message : String(cause),
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: tmaInitError,
        })
        return false
    }
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

function setTmaChromeColor(method: TelegramAppChromeMethod, color: string): void {
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

function configureTelegramChromeViaBridge(): TelegramChromeAttempt[] {
    const attempts: TelegramChromeAttempt[] = []
    if (!hasTelegramHostBridge()) return attempts

    postTelegramBridgeEvent('web_app_ready', undefined, attempts)
    postTelegramBridgeEvent('web_app_setup_swipe_behavior', { allow_vertical_swipe: false }, attempts)
    resetTelegramDocumentDrift('bridge-configure')
    return attempts
}

function syncTelegramChromeColorsViaBridge(color: string, attempts: TelegramChromeAttempt[]): void {
    if (!hasTelegramHostBridge()) return

    postTelegramBridgeEvent('web_app_set_header_color', { color }, attempts)
    postTelegramBridgeEvent('web_app_set_background_color', { color }, attempts)
    postTelegramBridgeEvent('web_app_set_bottom_bar_color', { color }, attempts)
    resetTelegramDocumentDrift('bridge-color-sync')
}

function postTelegramBridgeEvent(
    method: TelegramBridgeMethod,
    params: Record<string, unknown> | undefined,
    attempts: TelegramChromeAttempt[]
): boolean {
    try {
        postTelegramRawEvent(method, params)
        attempts.push({ method, candidate: params ? JSON.stringify(params) : 'none', ok: true })
        return true
    } catch (error) {
        attempts.push({
            method,
            candidate: params ? JSON.stringify(params) : 'none',
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        })
        return false
    }
}

function postTelegramRawEvent(method: TelegramBridgeMethod, params: Record<string, unknown> | undefined): void {
    const serializedParams = JSON.stringify(params ?? {})
    if (typeof window.TelegramWebviewProxy?.postEvent === 'function') {
        window.TelegramWebviewProxy.postEvent(method, serializedParams)
        return
    }

    const hostWindow = window as Window & { external?: { notify?: (message: string) => void } }
    if (typeof hostWindow.external?.notify === 'function') {
        hostWindow.external.notify(JSON.stringify({ eventType: method, eventData: params ?? {} }))
        return
    }

    throw new Error('Telegram host bridge is unavailable')
}

function getCurrentTelegramWebAppForDebug(): TelegramWebApp | null {
    const nativeWebApp = window.Telegram?.WebApp
    if (nativeWebApp) return nativeWebApp
    if (!tmaInitialized) return null

    const launchParams = safeRead(() => retrieveLaunchParams())
    return {
        initData: safeRead(() => retrieveRawInitData()) ?? '',
        themeParams: normalizeTelegramThemeParams(themeParams.state()),
        colorScheme: themeParams.isDark() ? 'dark' : 'light',
        platform: launchParams?.tgWebAppPlatform,
        version: launchParams?.tgWebAppVersion,
        headerColor: String(miniApp.headerColor()),
        backgroundColor: String(miniApp.bgColor()),
        bottomBarColor: String(miniApp.bottomBarColor()),
        ready: () => {},
        expand: () => {},
    }
}

function getRootCssVar(name: string): string | null {
    if (typeof document === 'undefined') return null
    const value = document.documentElement.style.getPropertyValue(name).trim()
    return value || null
}

function scheduleViewportHeightRefresh(reason: string): void {
    if (typeof window === 'undefined') return

    for (const delay of [0, 50, 250, 600]) {
        window.setTimeout(() => {
            window.dispatchEvent(new Event(APP_VIEWPORT_HEIGHT_REFRESH_EVENT))
            resetTelegramDocumentDrift(reason)
            if (delay === 250) {
                reportTelegramDebug('telegram-viewport-refresh', { reason, delay })
            }
        }, delay)
    }
}

function resetTelegramDocumentDrift(reason: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (!isTelegramEnvironment()) return

    const reset = () => {
        document.documentElement.scrollTop = 0
        if (document.body) document.body.scrollTop = 0
        if (window.scrollX !== 0 || window.scrollY !== 0) {
            safeCall(() => window.scrollTo(0, 0))
        }
    }

    window.requestAnimationFrame(reset)
    window.setTimeout(reset, 50)
    window.setTimeout(() => {
        reset()
        reportTelegramDebug('telegram-document-drift-reset', { reason })
    }, 250)
}

function getDocumentGeometrySnapshot(): Record<string, number | null> | null {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null

    const htmlRect = document.documentElement.getBoundingClientRect()
    const bodyRect = document.body?.getBoundingClientRect()
    const rootRect = document.getElementById('root')?.getBoundingClientRect()
    return {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        htmlScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body?.scrollTop ?? null,
        htmlTop: htmlRect.top,
        htmlBottom: htmlRect.bottom,
        htmlHeight: htmlRect.height,
        bodyTop: bodyRect?.top ?? null,
        bodyBottom: bodyRect?.bottom ?? null,
        bodyHeight: bodyRect?.height ?? null,
        rootTop: rootRect?.top ?? null,
        rootBottom: rootRect?.bottom ?? null,
        rootHeight: rootRect?.height ?? null,
    }
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
