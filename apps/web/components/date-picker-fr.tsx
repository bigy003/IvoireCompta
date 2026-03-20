"use client"

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { DayPicker } from "react-day-picker"
import { fr } from "date-fns/locale"
import { format, isValid, parseISO } from "date-fns"
import "react-day-picker/style.css"

type Props = {
  value: string
  onChange: (yyyyMmDd: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  fromYear?: number
  toYear?: number
}

export function DatePickerFr({
  value,
  onChange,
  placeholder = "Choisir une date",
  className = "",
  disabled,
  fromYear = 2020,
  toYear = new Date().getFullYear() + 3,
}: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const selected =
    value && isValid(parseISO(value + "T12:00:00"))
      ? parseISO(value + "T12:00:00")
      : undefined

  useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = () => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const gap = 8
    const margin = 12
    const estW = 300
    const estH = 420
    let left = rect.left
    let top = rect.bottom + gap
    if (left + estW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - estW - margin)
    }
    if (left < margin) left = margin
    if (top + estH > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - estH - gap)
    }
    setCoords({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScroll = () => updatePosition()
    const onResize = () => updatePosition()
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        buttonRef.current?.contains(t) ||
        popoverRef.current?.contains(t)
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  const y = new Date().getFullYear()
  const start = Math.min(fromYear, y - 1)
  const end = Math.max(toYear, y + 2)

  const popover = open && mounted && (
    <div
      ref={popoverRef}
      className="ivoire-daypicker-popover fixed rounded-2xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden max-h-[min(85vh,520px)] flex flex-col"
      style={{
        top: coords.top,
        left: coords.left,
        zIndex: 9999,
        width: "min(calc(100vw - 24px), 20rem)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Calendrier"
    >
      <div className="p-3 sm:p-4 overflow-y-auto flex-1 min-h-0">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={d => {
            if (d) {
              onChange(format(d, "yyyy-MM-dd"))
              setOpen(false)
            }
          }}
          locale={fr}
          defaultMonth={selected ?? new Date()}
          showOutsideDays
          captionLayout="dropdown"
          startMonth={new Date(start, 0)}
          endMonth={new Date(end, 11)}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gradient-to-r from-orange-50/60 to-white">
        <button
          type="button"
          className="text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
          onClick={() => {
            onChange("")
            setOpen(false)
          }}
        >
          Effacer
        </button>
        <button
          type="button"
          className="text-sm font-bold text-orange-600 hover:text-orange-700 transition-colors"
          onClick={() => {
            onChange(format(new Date(), "yyyy-MM-dd"))
            setOpen(false)
          }}
        >
          Aujourd&apos;hui
        </button>
      </div>
    </div>
  )

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-left bg-white hover:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400/80 focus:border-orange-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        <span
          className={
            selected ? "text-gray-900 font-medium truncate" : "text-gray-400"
          }
        >
          {selected
            ? format(selected, "dd/MM/yyyy", { locale: fr })
            : placeholder}
        </span>
        <svg
          className="w-5 h-5 text-orange-500 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </button>

      {mounted && popover && createPortal(popover, document.body)}
    </div>
  )
}
