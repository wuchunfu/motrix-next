/** @fileoverview Tests for file utilities. */
import { describe, it, expect } from 'vitest'
import { getFileName, getFileExtension, removeExtensionDot, isTorrent } from '../file'

describe('getFileName', () => {
    it('extracts filename from unix path', () => {
        expect(getFileName('/home/user/file.txt')).toBe('file.txt')
    })
    it('extracts filename from windows path', () => {
        expect(getFileName('C:\\Users\\file.txt')).toBe('file.txt')
    })
    it('returns filename for no separators', () => {
        expect(getFileName('file.txt')).toBe('file.txt')
    })
})

describe('getFileExtension', () => {
    it('extracts extension', () => {
        expect(getFileExtension('file.txt')).toBe('txt')
    })
    it('extracts last extension', () => {
        expect(getFileExtension('file.tar.gz')).toBe('gz')
    })
    it('returns empty for no extension', () => {
        expect(getFileExtension('file')).toBe('')
    })
})

describe('removeExtensionDot', () => {
    it('removes leading dot', () => {
        expect(removeExtensionDot('.txt')).toBe('txt')
    })
    it('returns unchanged for no dot', () => {
        expect(removeExtensionDot('txt')).toBe('txt')
    })
})

describe('isTorrent', () => {
    it('detects .torrent extension', () => {
        expect(isTorrent({ name: 'file.torrent', type: '' })).toBe(true)
    })
    it('detects by MIME type', () => {
        expect(isTorrent({ name: 'file', type: 'application/x-bittorrent' })).toBe(true)
    })
    it('rejects non-torrent files', () => {
        expect(isTorrent({ name: 'file.zip', type: 'application/zip' })).toBe(false)
    })
})
