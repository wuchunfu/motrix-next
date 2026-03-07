/** @fileoverview Unit tests for the centralized logger utility. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '@shared/logger'

describe('logger', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.spyOn(console, 'info').mockImplementation(() => { })
        vi.spyOn(console, 'debug').mockImplementation(() => { })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('logger.error calls console.error with formatted message', () => {
        logger.error('TestCtx', 'something failed')
        expect(console.error).toHaveBeenCalled()
        const call = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
        expect(call).toContain('[ERROR]')
        expect(call).toContain('TestCtx')
        expect(call).toContain('something failed')
    })

    it('logger.error logs error stack when Error instance provided', () => {
        const err = new Error('test error')
        logger.error('TestCtx', err)
        expect(console.error).toHaveBeenCalledTimes(2)
    })

    it('logger.warn calls console.warn with formatted message', () => {
        logger.warn('TestCtx', 'warning msg')
        expect(console.warn).toHaveBeenCalled()
        const call = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]
        expect(call).toContain('[WARN]')
        expect(call).toContain('TestCtx')
    })

    it('logger.error includes ISO timestamp', () => {
        logger.error('Ctx', 'msg')
        const call = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
        expect(call).toMatch(/\d{4}-\d{2}-\d{2}T/)
    })
})
