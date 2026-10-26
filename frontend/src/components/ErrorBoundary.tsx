import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reportError } from '../lib/observability'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(
      new Error(`${error.message}\n${info.componentStack ?? ''}`),
      'react.errorBoundary',
    )
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="font-serif text-3xl">Something went wrong.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The page hit an unexpected error. Reload to start a new transfer.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Reload page
          </button>
        </div>
      </main>
    )
  }
}
