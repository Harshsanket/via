import { Link, useLocation } from 'react-router-dom'

export default function Header() {
  const location = useLocation()

  if (location.pathname === '/') return null

  return (
    <header className="flex h-14 items-center px-4 sm:h-16 sm:px-6">
      <Link
        to="/"
        aria-label="Via home"
        className="inline-flex items-baseline rounded-md font-serif text-2xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-3xl"
      >
        via.
      </Link>
    </header>
  )
}
