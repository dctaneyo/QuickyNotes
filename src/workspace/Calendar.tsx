import { useMemo, useState } from 'react'
import { dateKey, parseDay, todayKey } from '../lib/notes'

interface CalendarProps {
  selected: string | null
  markers: Set<string>
  onSelect: (date: string) => void
}

export function Calendar({ selected, markers, onSelect }: CalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const base = selected ? parseDay(selected) : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const today = todayKey()

  const weeks = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 6 }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => {
        const date = new Date(start)
        date.setDate(start.getDate() + week * 7 + day)
        return date
      }),
    )
  }, [cursor])

  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + index)),
      ),
    [],
  )

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(cursor)

  const shiftMonth = (delta: number) => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  return (
    <div className="cal">
      <div className="cal__head">
        <span className="cal__month">{monthLabel}</span>
        <div className="cal__nav">
          <button type="button" className="icon-btn icon-btn--tiny" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="icon-btn icon-btn--tiny" onClick={() => shiftMonth(1)} aria-label="Next month">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="cal__grid cal__grid--labels" aria-hidden="true">
        {weekdayLabels.map((label, index) => (
          <span key={`${label}-${index}`} className="cal__weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="cal__grid" role="grid" aria-label="Pick a day">
        {weeks.flat().map((date) => {
          const key = dateKey(date)
          const outside = date.getMonth() !== cursor.getMonth()
          const isSelected = key === selected
          const hasNotes = markers.has(key)
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${key}${hasNotes ? ', has notes' : ''}`}
              className={`cal__day${outside ? ' is-outside' : ''}${
                key === today ? ' is-today' : ''
              }${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelect(key)}
            >
              <span>{date.getDate()}</span>
              {hasNotes ? <span className="cal__dot" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>

      <div className="cal__foot">
        <button
          type="button"
          className="link"
          onClick={() => {
            const now = new Date()
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1))
            onSelect(today)
          }}
        >
          Jump to today
        </button>
      </div>
    </div>
  )
}
