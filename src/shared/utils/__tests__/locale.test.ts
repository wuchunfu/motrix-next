/** @fileoverview Tests for locale utilities. */
import { describe, it, expect } from 'vitest'
import { isRTL, getLangDirection, calcFormLabelWidth } from '../locale'

describe('isRTL', () => {
    it('returns true for Arabic', () => {
        expect(isRTL('ar')).toBe(true)
    })
    it('returns false for English', () => {
        expect(isRTL('en-US')).toBe(false)
    })
    it('returns false for default', () => {
        expect(isRTL()).toBe(false)
    })
})

describe('getLangDirection', () => {
    it('returns rtl for Arabic', () => {
        expect(getLangDirection('ar')).toBe('rtl')
    })
    it('returns ltr for English', () => {
        expect(getLangDirection('en-US')).toBe('ltr')
    })
})

describe('calcFormLabelWidth', () => {
    it('returns 28% for German', () => {
        expect(calcFormLabelWidth('de-DE')).toBe('28%')
    })
    it('returns 25% for English', () => {
        expect(calcFormLabelWidth('en-US')).toBe('25%')
    })
})
