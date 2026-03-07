/** @fileoverview Tests for config utilities. */
import { describe, it, expect } from 'vitest'
import {
    changeKeysToCamelCase,
    changeKeysToKebabCase,
    validateNumber,
    fixValue,
    separateConfig,
    diffConfig,
    checkIsNeedRestart,
    checkIsNeedRun,
    buildRpcUrl,
    formatOptionsForEngine,
    parseHeader,
} from '../config'

describe('changeKeysToCamelCase', () => {
    it('converts kebab-case keys to camelCase', () => {
        expect(changeKeysToCamelCase({ 'max-speed': 100 })).toEqual({ maxSpeed: 100 })
    })
    it('returns empty for empty object', () => {
        expect(changeKeysToCamelCase({})).toEqual({})
    })
})

describe('changeKeysToKebabCase', () => {
    it('converts camelCase keys to kebab-case', () => {
        expect(changeKeysToKebabCase({ maxSpeed: 100 })).toEqual({ 'max-speed': 100 })
    })
})

describe('validateNumber', () => {
    it('validates numbers', () => {
        expect(validateNumber(42)).toBe(true)
        expect(validateNumber(3.14)).toBe(true)
    })
    it('rejects non-numbers', () => {
        expect(validateNumber('abc')).toBe(false)
        expect(validateNumber(NaN)).toBe(false)
        expect(validateNumber(Infinity)).toBe(false)
    })
})

describe('fixValue', () => {
    it('converts string booleans and numbers', () => {
        const result = fixValue({ a: 'true', b: 'false', c: '42', d: 'text' })
        expect(result).toEqual({ a: true, b: false, c: '42', d: 'text' })
    })
})

describe('separateConfig', () => {
    it('separates user, system, and other keys', () => {
        const result = separateConfig({ theme: 'dark', dir: '/tmp', unknownKey: 'val' })
        expect(result.user).toHaveProperty('theme')
        expect(result.system).toHaveProperty('dir')
        expect(result.others).toHaveProperty('unknownKey')
    })
})

describe('diffConfig', () => {
    it('returns only changed keys', () => {
        const result = diffConfig({ a: 1, b: 2 }, { a: 1, b: 3 })
        expect(result).toEqual({ b: 3 })
    })
    it('returns empty for identical configs', () => {
        const result = diffConfig({ a: 1 }, { a: 1 })
        expect(result).toEqual({})
    })
})

describe('checkIsNeedRestart', () => {
    it('returns false for empty changes', () => {
        expect(checkIsNeedRestart({})).toBe(false)
    })
    it('returns true for restart-required keys', () => {
        expect(checkIsNeedRestart({ rpcListenPort: 6800 })).toBe(true)
    })
    it('returns false for non-restart keys', () => {
        expect(checkIsNeedRestart({ theme: 'dark' })).toBe(false)
    })
})

describe('checkIsNeedRun', () => {
    it('returns false when disabled', () => {
        expect(checkIsNeedRun(false, 0, 1000)).toBe(false)
    })
    it('returns true when interval exceeded', () => {
        expect(checkIsNeedRun(true, Date.now() - 10000, 5000)).toBe(true)
    })
    it('returns false when within interval', () => {
        expect(checkIsNeedRun(true, Date.now() - 1000, 5000)).toBe(false)
    })
})

describe('buildRpcUrl', () => {
    it('builds url without secret', () => {
        expect(buildRpcUrl({ port: 6800 })).toContain(':6800/jsonrpc')
    })
    it('builds url with secret', () => {
        const result = buildRpcUrl({ port: 6800, secret: 'abc' })
        expect(result).toContain('token:abc@')
    })
})

describe('formatOptionsForEngine', () => {
    it('converts keys to kebab-case', () => {
        const result = formatOptionsForEngine({ maxSpeed: '100' })
        expect(result).toHaveProperty('max-speed')
    })
    it('joins arrays with newline', () => {
        const result = formatOptionsForEngine({ trackerSource: ['a', 'b'] })
        expect(result['tracker-source']).toBe('a\nb')
    })
    it('skips null/undefined values', () => {
        const result = formatOptionsForEngine({ a: undefined, b: null, c: '' })
        expect(Object.keys(result).length).toBe(0)
    })
})

describe('parseHeader', () => {
    it('parses header string', () => {
        const result = parseHeader('Content-Type: text/html')
        expect(result.contentType).toBe('text/html')
    })
    it('returns empty for empty string', () => {
        expect(parseHeader('')).toEqual({})
    })
})
