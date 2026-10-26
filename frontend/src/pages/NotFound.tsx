import { Link } from 'react-router-dom'

import { Button } from '../components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-serif text-6xl">404</p>
      <h1 className="text-2xl font-semibold">This page does not exist.</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Check the receive link, or start a new transfer from the home page.
      </p>
      <Button asChild>
        <Link to="/">Back to Via</Link>
      </Button>
    </div>
  )
}
