import type { ReactNode } from 'react'

interface PageHeaderProps {
  icon: ReactNode
  title: string
  description?: string
}

export default function PageHeader({ icon, title, description }: PageHeaderProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center justify-center gap-4">
        {icon}
        <h1 className="font-serif text-4xl font-light tracking-tighter md:text-6xl">
          {title}
        </h1>
      </div>
      {description && (
        <p className="mt-5 text-lg font-light text-muted-foreground sm:text-xl">
          {description}
        </p>
      )}
    </div>
  )
}
