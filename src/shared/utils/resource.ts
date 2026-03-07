/** @fileoverview Download resource detection: Thunder links, protocol tags, copyright. */
import { compact } from 'lodash-es'
import { RESOURCE_TAGS } from '@shared/constants'
import { splitTextRows } from './format'
import { isAudioOrVideo } from './file'

/** Decodes a Thunder (迅雷) protocol link to its original HTTP/FTP URL. */
export const decodeThunderLink = (url = ''): string => {
    if (!url.startsWith('thunder://')) return url
    let result = url.trim()
    result = result.split('thunder://')[1]
    result = atob(result)
    result = result.substring(2, result.length - 2)
    return result
}

export const splitTaskLinks = (links = ''): string[] => {
    const temp = compact(splitTextRows(links))
    return temp.map((item) => decodeThunderLink(item))
}

/** Returns true if the content string contains any recognized download protocol tag. */
export const detectResource = (content: string): boolean => {
    return RESOURCE_TAGS.some((type) => content.includes(type))
}

export const needCheckCopyright = (links = ''): boolean => {
    const uris = splitTaskLinks(links)
    const avs = uris.filter((uri) => isAudioOrVideo(uri))
    return avs.length > 0
}
