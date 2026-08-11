import { useEffect } from 'react'
import { isTelegramEnvironment } from '@/hooks/useTelegram'

export const APP_VIEWPORT_HEIGHT_REFRESH_EVENT = 'hapi-viewport-height-refresh'

export function updateAppViewportHeight(params: {
    root: HTMLElement
    viewportHeight: number
    windowHeight: number
    isTelegram: boolean
    scrollY: number
    scrollTo: (x: number, y: number) => void
}): void {
    const { root, viewportHeight, windowHeight, isTelegram, scrollY, scrollTo } = params
    const roundedViewportHeight = Math.round(viewportHeight)
    const diff = windowHeight - viewportHeight

    if (roundedViewportHeight > 0 && (isTelegram || diff > 1)) {
        root.style.setProperty('--app-viewport-height', `${roundedViewportHeight}px`)
        // On iOS PWA (black-translucent status bar + viewport-fit=cover),
        // the browser scrolls the page upward when the keyboard opens to keep
        // the focused input visible. Reset the page scroll so the app stays
        // pinned to the top; inner flex layouts handle keeping inputs visible.
        if (diff > 1 && scrollY > 0) {
            scrollTo(0, 0)
        }
    } else {
        root.style.removeProperty('--app-viewport-height')
    }
}

/**
 * Sets a CSS custom property `--app-viewport-height` on <html> that tracks the
 * visual viewport height. This is a fallback for browsers that do not support
 * the `interactive-widget=resizes-content` viewport meta attribute — on those
 * browsers `100dvh` does NOT shrink when the virtual keyboard opens, so the
 * composer input is hidden behind the keyboard.
 *
 * The hook listens to `window.visualViewport.resize` and writes the viewport
 * height into the CSS variable. In Telegram Mini Apps we keep this variable set
 * all the time as a fallback for clients that do not refresh SDK viewport CSS
 * variables after native chrome color changes.
 */
export function useViewportHeight(): void {
    useEffect(() => {
        const viewport = window.visualViewport
        if (!viewport) return

        const root = document.documentElement
        const isTelegram = isTelegramEnvironment()

        function update() {
            if (!viewport) return
            updateAppViewportHeight({
                root,
                viewportHeight: viewport.height,
                windowHeight: window.innerHeight,
                isTelegram,
                scrollY: window.scrollY,
                scrollTo: window.scrollTo.bind(window),
            })
        }

        update()
        viewport.addEventListener('resize', update)
        viewport.addEventListener('scroll', update)
        window.addEventListener(APP_VIEWPORT_HEIGHT_REFRESH_EVENT, update)

        return () => {
            viewport.removeEventListener('resize', update)
            viewport.removeEventListener('scroll', update)
            window.removeEventListener(APP_VIEWPORT_HEIGHT_REFRESH_EVENT, update)
            root.style.removeProperty('--app-viewport-height')
        }
    }, [])
}
