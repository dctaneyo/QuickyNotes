import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </Svg>
  )
}

export function NotesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h9.5L19 7v13.5H6z" />
      <path d="M15 3.5V7h4M9 11h7M9 15h7M9 18.5h4" />
    </Svg>
  )
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.5l2.6 5.5 5.9.8-4.3 4.2 1 6-5.2-2.9-5.2 2.9 1-6L3.5 9.8l5.9-.8z" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15M9.5 7V4.6h5V7M6.5 7l.9 12.4h9.2L17.5 7M10 10.5v6M14 10.5v6" />
    </Svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.4 15.4L20 20" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function RestoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5v5h5" />
      <path d="M4.8 13a7.5 7.5 0 1 0 1.6-6.4L4 10" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2.4}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Svg>
  )
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h6.6L20 13.4 13.4 20 4 10.6z" />
      <circle cx="8.1" cy="8.1" r="1.2" />
    </Svg>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.8" y="5.4" width="16.4" height="14.6" rx="1.4" />
      <path d="M3.8 9.8h16.4M8.4 3.4v3.6M15.6 3.4v3.6" />
    </Svg>
  )
}

export function ShareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="17.5" cy="5.8" r="2.8" />
      <circle cx="6.2" cy="12" r="2.8" />
      <circle cx="17.5" cy="18.2" r="2.8" />
      <path d="M8.7 10.7l6.2-3.4M8.7 13.3l6.2 3.4" />
    </Svg>
  )
}

export function HistoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8L3.8 8.6" />
      <path d="M3.8 4.4v4.2h4.2M12 7.6V12l3 1.8" />
    </Svg>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="10.4" width="14" height="9.6" rx="2" />
      <path d="M8.5 10.4V7.7a3.5 3.5 0 0 1 7 0v2.7M12 14.4v2.2" />
    </Svg>
  )
}

export function DotsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

export function HighlighterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.2 14.2l-2.3 2.3-1.8 3.9 3.9-1.8 2.3-2.3" />
      <path d="M9.4 13l5.8-5.8 3.6 3.6-5.8 5.8z" />
      <path d="M14.2 4.4l1.5-1.5 3.6 3.6-1.5 1.5" />
    </Svg>
  )
}

export function ResetFormatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.8 15.5l6.9-9.4a2 2 0 0 1 2.8-.3l2.6 1.9a2 2 0 0 1 .3 2.8l-6.9 9.4" />
      <path d="M4.8 15.5l3.2 2.4 2.7-3.6M10 19.2h9.2" />
    </Svg>
  )
}

export function CommentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.2h16v11H9.5L5 20v-3.8H4z" />
      <path d="M8 9h8M8 12.4h5.5" />
    </Svg>
  )
}

export function MentionIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8.5v4.2a2.8 2.8 0 0 0 5.6 0V12a9.6 9.6 0 1 0-3.8 7.7" />
    </Svg>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 9.2a5.5 5.5 0 0 1 11 0c0 5.6 2 7.4 2 7.4h-15s2-1.8 2-7.4z" />
      <path d="M9.6 19a2.7 2.7 0 0 0 4.8 0" />
    </Svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 5l-7 7 7 7M3 12h18" />
    </Svg>
  )
}
