import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateAppViewportHeight } from './useViewportHeight'

/**
 * Unit tests for the useViewportHeight hook logic.
 *
 * Because the hook depends on window.visualViewport (not available in jsdom),
 * we test the core update logic directly rather than rendering the hook.
 */
describe('useViewportHeight update logic', () => {
    const root = document.documentElement

    beforeEach(() => {
        root.style.removeProperty('--app-viewport-height')
    })

    afterEach(() => {
        root.style.removeProperty('--app-viewport-height')
    })

    it('sets --app-viewport-height when visual viewport is smaller than window', () => {
        updateAppViewportHeight({
            root,
            viewportHeight: 400,
            windowHeight: 800,
            isTelegram: false,
            scrollY: 0,
            scrollTo: vi.fn(),
        })

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('400px')
    })

    it('removes --app-viewport-height when viewports match', () => {
        // First set it
        root.style.setProperty('--app-viewport-height', '400px')

        updateAppViewportHeight({
            root,
            viewportHeight: 800,
            windowHeight: 800,
            isTelegram: false,
            scrollY: 0,
            scrollTo: vi.fn(),
        })

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('')
    })

    it('ignores sub-pixel differences (threshold of 1px)', () => {
        updateAppViewportHeight({
            root,
            viewportHeight: 799.5,
            windowHeight: 800,
            isTelegram: false,
            scrollY: 0,
            scrollTo: vi.fn(),
        })

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('')
    })

    it('keeps --app-viewport-height set in Telegram Mini Apps', () => {
        updateAppViewportHeight({
            root,
            viewportHeight: 702.4,
            windowHeight: 702,
            isTelegram: true,
            scrollY: 0,
            scrollTo: vi.fn(),
        })

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('702px')
    })

    it('resets page scroll when keyboard is open', () => {
        const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

        // Simulate: keyboard open AND page has been scrolled by iOS
        Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })

        updateAppViewportHeight({
            root,
            viewportHeight: 400,
            windowHeight: 800,
            isTelegram: false,
            scrollY: window.scrollY,
            scrollTo: window.scrollTo.bind(window),
        })

        expect(scrollToSpy).toHaveBeenCalledWith(0, 0)

        // Cleanup
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
        scrollToSpy.mockRestore()
    })

    it('does not reset scroll when page is not scrolled', () => {
        const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })

        updateAppViewportHeight({
            root,
            viewportHeight: 400,
            windowHeight: 800,
            isTelegram: false,
            scrollY: window.scrollY,
            scrollTo: window.scrollTo.bind(window),
        })

        expect(scrollToSpy).not.toHaveBeenCalled()

        scrollToSpy.mockRestore()
    })
})
