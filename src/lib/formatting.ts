import type { CSSProperties } from 'react'
import type { BlockType } from './types'

/**
 * Formatting is stored per block. The editor is deliberately line-oriented:
 * every block shares one typographic style so collaboration, caret placement
 * and activity history stay exact.
 */
export interface BlockFormat {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  fontSize: number | null
  color: string | null
  highlight: string | null
}

export const DEFAULT_BLOCK_FORMAT: BlockFormat = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  fontSize: null,
  color: null,
  highlight: null,
}

export const MIN_FONT_SIZE = 11
export const MAX_FONT_SIZE = 48

export const BLOCK_BASE_FONT_SIZE: Record<BlockType, number> = {
  text: 16,
  h1: 27,
  h2: 20,
  h3: 16.5,
  bullet: 16,
  number: 16,
  todo: 16,
  quote: 16,
  code: 13,
  callout: 14.5,
  divider: 16,
}

export interface ColorChoice {
  label: string
  value: string | null
}

export const TEXT_COLORS: ColorChoice[] = [
  { label: 'Default ink', value: null },
  { label: 'Graphite', value: '#6f7670' },
  { label: 'Crimson', value: '#c23b32' },
  { label: 'Tangerine', value: '#c8651d' },
  { label: 'Fern', value: '#0f8b63' },
  { label: 'Cobalt', value: '#2d6bff' },
  { label: 'Violet', value: '#7548d6' },
  { label: 'Rose', value: '#c13a70' },
]

export const HIGHLIGHT_COLORS: ColorChoice[] = [
  { label: 'No highlight', value: null },
  { label: 'Butter', value: '#fff0a8' },
  { label: 'Mint', value: '#d7f4e2' },
  { label: 'Sky', value: '#dbe9ff' },
  { label: 'Lilac', value: '#ece2ff' },
  { label: 'Peach', value: '#ffe1d2' },
  { label: 'Rose', value: '#ffdbe8' },
]

const HEX = /^#[0-9a-f]{6}$/i

export function clampFontSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

export function normalizeBlockFormat(raw: Partial<BlockFormat> | null | undefined): BlockFormat {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BLOCK_FORMAT }
  const size = Number(raw.fontSize)
  return {
    bold: raw.bold === true,
    italic: raw.italic === true,
    underline: raw.underline === true,
    strike: raw.strike === true,
    fontSize: Number.isFinite(size) && size > 0 ? clampFontSize(size) : null,
    color: typeof raw.color === 'string' && HEX.test(raw.color) ? raw.color.toLowerCase() : null,
    highlight:
      typeof raw.highlight === 'string' && HEX.test(raw.highlight)
        ? raw.highlight.toLowerCase()
        : null,
  }
}

export function isDefaultBlockFormat(format: BlockFormat): boolean {
  return (
    !format.bold &&
    !format.italic &&
    !format.underline &&
    !format.strike &&
    format.fontSize == null &&
    format.color == null &&
    format.highlight == null
  )
}

/** Inline textarea styles. Backgrounds paint the block band, never the carets. */
export function formatTextStyle(format: BlockFormat): CSSProperties {
  const decorations = [format.underline ? 'underline' : '', format.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')
  return {
    fontWeight: format.bold ? 700 : undefined,
    fontStyle: format.italic ? 'italic' : undefined,
    textDecorationLine: decorations || undefined,
    textDecorationThickness: decorations ? '0.07em' : undefined,
    textUnderlineOffset: format.underline ? '0.16em' : undefined,
    fontSize: format.fontSize ? `${format.fontSize}px` : undefined,
    color: format.color ?? undefined,
    caretColor: format.color ?? undefined,
    backgroundColor: format.highlight ?? undefined,
    borderRadius: format.highlight ? '4px' : undefined,
  }
}

export function formatSignature(format: BlockFormat): string {
  return [
    format.bold ? 'b' : '',
    format.italic ? 'i' : '',
    format.underline ? 'u' : '',
    format.strike ? 's' : '',
    format.fontSize ?? '',
    format.color ?? '',
    format.highlight ?? '',
  ].join('|')
}
