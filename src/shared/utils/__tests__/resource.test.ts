/** @fileoverview Tests for resource detection utilities. */
import { describe, it, expect } from 'vitest'
import { decodeThunderLink, splitTaskLinks, detectResource, needCheckCopyright } from '../resource'

describe('decodeThunderLink', () => {
    it('returns non-thunder links unchanged', () => {
        expect(decodeThunderLink('http://example.com/file.zip')).toBe('http://example.com/file.zip')
    })
    it('decodes thunder:// encoded link', () => {
        const encoded = 'thunder://' + btoa('AAhttp://example.com/file.zipZZ')
        const result = decodeThunderLink(encoded)
        expect(result).toBe('http://example.com/file.zip')
    })
})

describe('splitTaskLinks', () => {
    it('splits multiline links', () => {
        const result = splitTaskLinks('http://a.com\nhttp://b.com')
        expect(result).toEqual(['http://a.com', 'http://b.com'])
    })
    it('returns empty for empty input', () => {
        expect(splitTaskLinks('')).toEqual([])
    })
})

describe('detectResource', () => {
    it('detects http links', () => {
        expect(detectResource('http://example.com')).toBe(true)
    })
    it('detects magnet links', () => {
        expect(detectResource('magnet:?xt=urn:btih:abc')).toBe(true)
    })
    it('returns false for plain text', () => {
        expect(detectResource('hello world')).toBe(false)
    })
})

describe('needCheckCopyright', () => {
    it('returns true for video links', () => {
        expect(needCheckCopyright('http://example.com/video.mp4')).toBe(true)
    })
    it('returns false for non-media links', () => {
        expect(needCheckCopyright('http://example.com/file.zip')).toBe(false)
    })
})
