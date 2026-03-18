import Link from "next/link"

type Props = {
  /** Lien au clic sur le logo (ex. / ou /login) */
  logoHref?: string
}

/**
 * Barre de navigation flottante type « pilule » (login / inscription).
 * Logo : /images/logo.png
 */
export function AuthFloatingHeader({ logoHref = "/" }: Props) {
  return (
    <header className="fixed left-0 right-0 top-0 z-50 px-3 pt-4 pb-2 sm:px-5 md:px-8 lg:px-10 pointer-events-none">
      <div
        className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-full border border-white/90 bg-white/95 px-4 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-md sm:px-6 sm:py-2.5 md:px-8"
        style={{ boxShadow: "0 8px 28px rgba(0,0,0,0.07), 0 2px 10px rgba(249,115,22,0.05)" }}
      >
        <Link
          href={logoHref}
          className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-90"
        >
          <img
            src="/images/logo.png"
            alt="IvoireCompta"
            className="h-8 w-8 shrink-0 object-contain"
          />
          <span className="truncate text-base font-extrabold tracking-tight text-gray-800">
            Ivoire
            <span className="font-bold text-orange-500">Compta</span>
          </span>
        </Link>

        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200/80 bg-gray-50/90 px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100"
          aria-label="Langue : français"
        >
          <span className="text-sm leading-none" aria-hidden>
            🇫🇷
          </span>
          <svg
            className="h-3.5 w-3.5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </header>
  )
}
