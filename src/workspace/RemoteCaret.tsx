import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export interface RemoteCaretPeer {
  clientId: number
  displayName: string
  color: string
  index: number
}

interface RemoteCaretsProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  text: string
  peers: RemoteCaretPeer[]
  /** Changes whenever the block's type styling changes, so positions remeasure. */
  metricsKey?: string
}

interface Placement {
  left: number
  top: number
  height: number
  flip: boolean
  alignRight: boolean
}

/** Styles that decide where a character lands inside a textarea. */
function copyTextMetrics(source: CSSStyleDeclaration, target: HTMLElement) {
  target.style.fontFamily = source.fontFamily
  target.style.fontSize = source.fontSize
  target.style.fontWeight = source.fontWeight
  target.style.fontStyle = source.fontStyle
  target.style.fontVariant = source.fontVariant
  target.style.lineHeight = source.lineHeight
  target.style.letterSpacing = source.letterSpacing
  target.style.wordSpacing = source.wordSpacing
  target.style.textTransform = source.textTransform
  target.style.textIndent = source.textIndent
  target.style.textAlign = source.textAlign
  target.style.textRendering = source.textRendering
  target.style.direction = source.direction
  target.style.tabSize = source.tabSize
  target.style.padding = source.padding
  target.style.whiteSpace = 'pre-wrap'
  target.style.overflowWrap = 'break-word'
  target.style.wordBreak = 'break-word'
}

/**
 * Remote carets are painted inside a wrapper that shares the textarea's box.
 * One hidden mirror holds a zero-width marker per peer, so a single layout pass
 * measures every caret and the browser's real line wrapping does the math.
 */
export function RemoteCarets({ textareaRef, text, peers, metricsKey }: RemoteCaretsProps) {
  const [placements, setPlacements] = useState<Record<number, Placement>>({})
  const [measureVersion, setMeasureVersion] = useState(0)

  useEffect(() => {
    const el = textareaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setMeasureVersion((value) => value + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [textareaRef])

  const signature = peers.map((peer) => `${peer.clientId}:${peer.index}`).join('|')

  useLayoutEffect(() => {
    if (peers.length === 0) {
      setPlacements((previous) => (Object.keys(previous).length ? {} : previous))
      return
    }

    const el = textareaRef.current
    const editor = el?.parentElement
    if (!el || !editor || el.clientWidth <= 0) {
      setPlacements((previous) => (Object.keys(previous).length ? {} : previous))
      return
    }

    const computed = window.getComputedStyle(el)
    const mirror = document.createElement('div')
    mirror.setAttribute('aria-hidden', 'true')
    // Sit exactly on the textarea's border box, including any heading margin.
    mirror.style.position = 'absolute'
    mirror.style.left = `${el.offsetLeft}px`
    mirror.style.top = `${el.offsetTop}px`
    mirror.style.width = `${el.clientWidth}px`
    mirror.style.boxSizing = 'border-box'
    mirror.style.margin = '0'
    mirror.style.border = '0'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.zIndex = '-1'
    copyTextMetrics(computed, mirror)

    const fontPx = parseFloat(computed.fontSize) || 16
    const lineHeight = parseFloat(computed.lineHeight) || fontPx * 1.5
    const ordered = [...peers].sort((a, b) => a.index - b.index)
    const markers = new Map<number, HTMLElement>()

    let consumed = 0
    for (const peer of ordered) {
      const requested = Number.isFinite(peer.index) ? Math.floor(peer.index) : 0
      const index = Math.max(consumed, Math.min(requested, text.length))
      mirror.appendChild(document.createTextNode(text.slice(consumed, index)))

      const marker = document.createElement('span')
      marker.textContent = '\u200b'
      marker.style.display = 'inline-block'
      marker.style.width = '0'
      marker.style.height = `${lineHeight}px`
      marker.style.verticalAlign = 'top'
      mirror.appendChild(marker)
      markers.set(peer.clientId, marker)
      consumed = index
    }
    mirror.appendChild(document.createTextNode(text.slice(consumed)))

    // The mirror has to live in the layout to report real positions.
    editor.appendChild(mirror)

    try {
      const editorRect = editor.getBoundingClientRect()
      const next: Record<number, Placement> = {}
      for (const peer of ordered) {
        const marker = markers.get(peer.clientId)
        if (!marker) continue
        const rect = marker.getBoundingClientRect()
        const left = Math.max(0, rect.left - editorRect.left - el.scrollLeft)
        const top = Math.max(0, rect.top - editorRect.top - el.scrollTop)
        next[peer.clientId] = {
          left,
          top,
          height: lineHeight,
          flip: top < 30,
          alignRight: left > el.clientWidth - 140,
        }
      }

      setPlacements((previous) => {
        const keys = Object.keys(next)
        if (keys.length !== Object.keys(previous).length) return next
        for (const key of keys) {
          const before = previous[Number(key)]
          const after = next[Number(key)]
          if (
            !before ||
            Math.abs(before.left - after.left) >= 0.5 ||
            Math.abs(before.top - after.top) >= 0.5 ||
            Math.abs(before.height - after.height) >= 0.5 ||
            before.flip !== after.flip ||
            before.alignRight !== after.alignRight
          ) {
            return next
          }
        }
        return previous
      })
    } finally {
      mirror.remove()
    }
  }, [textareaRef, text, peers, signature, measureVersion, metricsKey])

  return (
    <>
      {peers.map((peer) => {
        const position = placements[peer.clientId]
        if (!position) return null
        return (
          <span
            key={peer.clientId}
            className={`remote-caret${position.flip ? ' remote-caret--flip' : ''}${
              position.alignRight ? ' remote-caret--right' : ''
            }`}
            style={
              {
                left: `${position.left}px`,
                top: `${position.top}px`,
                height: `${position.height}px`,
                '--caret-color': peer.color,
                '--caret-delay': `${-((peer.clientId % 7) * 0.13)}s`,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <span className="remote-caret__line" />
            <span className="remote-caret__tag">{peer.displayName}</span>
          </span>
        )
      })}
    </>
  )
}
