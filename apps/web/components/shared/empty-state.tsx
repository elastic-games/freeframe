'use client'

import { useTranslation } from '@/lib/i18n/locale-provider'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const tr = useTranslation()
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 px-6 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-tertiary text-text-tertiary">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text-primary">{tr(title)}</p>
        {description && (
          <p className="text-xs text-text-secondary max-w-xs">{tr(description)}</p>
        )}
      </div>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {tr(action.label)}
        </Button>
      )}
    </div>
  )
}
