'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Layers,
  Bell,
  Upload,
  Settings,
  LogOut,
  User,
  ChevronsLeft,
  PanelLeft,
  Moon,
  Sun,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useUploadStore } from '@/stores/upload-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useBranding } from '@/components/shared/branding-provider'
import { useResolvedTheme } from '@/hooks/use-resolved-theme'
import { resolveBrandingLogo } from '@/lib/branding-logo'
import { Avatar } from '@/components/shared/avatar'
import { ThemedDefaultLogo } from '@/components/shared/themed-default-logo'
import { NotificationDrawer } from './notification-drawer'
import useSWR from 'swr'
import { api } from '@/lib/api'
import { StorageUsage, StorageRing } from '@/components/shared/storage-usage'
import type { InstanceSettings } from '@/types'
import { useThemeStore } from '@/stores/theme-store'
import { requestStudioControl } from '@/lib/studio-embed'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { href: '/projects', label: 'Projects', icon: Layers },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const studioManaged = process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS === 'true'
  const hostTheme = useThemeStore((s) => s.hostTheme)
  const embedded = hostTheme !== null
  // The embedded toolbar never expands into a second sidebar.
  const compact = embedded || collapsed
  const pathname = usePathname()
  const { user, logout, isSuperAdmin } = useAuthStore()
  const { files: uploadFiles, togglePanel, panelOpen } = useUploadStore()
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const { orgName, orgLogoDark, orgLogoLight } = useBranding()
  // Resolved, not the raw preference: 'system' is neither 'light' nor 'dark',
  // so comparing it directly handed a system-light viewer the dark-background
  // logo on a light page.
  const theme = useResolvedTheme()
  const customLogo = resolveBrandingLogo({
    theme,
    darkUrl: orgLogoDark,
    lightUrl: orgLogoLight,
  })
  const [notifOpen, setNotifOpen] = React.useState(false)
  const currentProject = pathname?.match(/\/projects\/([0-9a-f]{8}-[0-9a-f-]{27,})(?:\/|$)/i)?.[1]
  const activeUploads = uploadFiles.filter((f) =>
    (!studioManaged || f.projectId === currentProject) &&
    (f.status === 'uploading' || f.status === 'pending' || f.status === 'processing')).length
  const { data: instance } = useSWR<InstanceSettings>(
    studioManaged ? null : '/instance/settings',
    () => api.get<InstanceSettings>('/instance/settings'),
  )

  React.useEffect(() => {
    if (!studioManaged) fetchNotifications()
  }, [fetchNotifications, studioManaged])

  return (
    <>
      <aside
        aria-label={embedded ? 'Video Reviews controls' : 'FreeFrame navigation'}
        className={cn(
          'z-30 flex border-border bg-bg-secondary overflow-hidden shrink-0',
          embedded ? 'relative h-11 w-full flex-row items-center border-b px-2 gap-1' :
            'fixed left-0 top-0 h-screen flex-col border-r transition-[width] duration-200',
          !embedded && (collapsed ? 'w-[52px]' : 'w-[220px]'),
        )}
      >
        {/* Logo */}
        {embedded ? (
          <button type="button" onClick={() => requestStudioControl('toggle-navigation')}
            aria-label="Toggle Studio navigation" title="Toggle Studio navigation"
            className="h-8 w-8 shrink-0 grid place-items-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary">
            <PanelLeft className="h-4 w-4" />
          </button>
        ) : <div
          className={cn(
            'flex h-12 items-center shrink-0 border-b border-border',
            collapsed ? 'justify-center px-0' : 'px-4 gap-2.5',
          )}
        >
          {customLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={customLogo}
              alt={orgName}
              className="h-7 w-7 shrink-0 object-contain rounded"
            />
          ) : (
            <ThemedDefaultLogo
              variant="icon"
              alt={orgName}
              className="h-7 w-7 shrink-0 object-contain"
            />
          )}
          {!collapsed && (
            <span className="text-sm font-semibold text-text-primary tracking-tight truncate">
              {orgName}
            </span>
          )}
        </div>}

        {/* Navigation */}
        <nav className={cn('flex-1 min-w-0', embedded ? 'flex items-center gap-1' : 'overflow-y-auto overflow-x-hidden py-2 px-2 space-y-0.5')}>
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNotifOpen(false)}
                className={cn(
                  'group relative flex items-center rounded-md transition-colors duration-100',
                  embedded ? 'gap-2 px-2 h-8' : collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 h-9',
                  isActive
                    ? 'bg-bg-hover text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
                )}
                title={compact ? item.label : undefined}
              >
                <Icon
                  className="h-[18px] w-[18px] shrink-0"
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {(!collapsed || embedded) && (
                  <span
                    className={cn('text-[13px]', isActive && 'font-medium')}
                  >
                    {item.label}
                  </span>
                )}
              </Link>
            )
          })}

          {/* Notifications button */}
          {!studioManaged && <button
            onClick={() => setNotifOpen((v) => !v)}
            className={cn(
              'group relative flex items-center rounded-md transition-colors duration-100',
              embedded ? 'gap-2 h-8 px-2' : collapsed ? 'justify-center h-9 w-9 mx-auto' : 'w-full gap-2.5 px-2.5 h-9',
              notifOpen
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
            )}
            aria-label="Notifications"
            title={compact ? 'Notifications' : undefined}
          >
            <div className="relative shrink-0">
              <Bell
                className="h-[18px] w-[18px]"
                strokeWidth={notifOpen ? 2 : 1.5}
              />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-0.5 text-[9px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            {(!collapsed || embedded) && (
              <span className={cn('text-[13px]', embedded && 'hidden sm:inline', notifOpen && 'font-medium')}>
                Notifications
              </span>
            )}
          </button>}

          {/* Uploads button */}
          <button
            onClick={() => { setNotifOpen(false); togglePanel() }}
            className={cn(
              'group relative flex items-center rounded-md transition-colors duration-100',
              embedded ? 'gap-2 h-8 px-2' : collapsed ? 'justify-center h-9 w-9 mx-auto' : 'w-full gap-2.5 px-2.5 h-9',
              panelOpen
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
            )}
            aria-label="Uploads"
            title={compact ? 'Uploads' : undefined}
          >
            <div className="relative shrink-0">
              <Upload className="h-[18px] w-[18px]" strokeWidth={panelOpen ? 2 : 1.5} />
              {activeUploads > 0 && (
                <span className="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-white">
                  {activeUploads}
                </span>
              )}
            </div>
            {(!collapsed || embedded) && (
              <span className={cn('text-[13px]', embedded && 'hidden sm:inline', panelOpen && 'font-medium')}>
                Uploads
              </span>
            )}
          </button>
      </nav>

      {/* Bottom section */}
      <div className={cn('shrink-0', embedded ? 'flex items-center gap-1' : 'border-t border-border p-2 space-y-1')}>
        {embedded && <button type="button"
          onClick={() => requestStudioControl('set-theme', hostTheme === 'dark' ? 'light' : 'dark')}
          aria-label={hostTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title="Studio appearance"
          className="h-8 w-8 grid place-items-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary">
          {hostTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>}
        {/* Instance storage indicator — ring when collapsed, used/limit bar when expanded */}
        {instance && (
          <div className={cn(embedded ? 'hidden md:flex justify-center px-1' : collapsed ? 'flex justify-center py-1' : 'px-2.5 py-1.5')}>
            {compact ? (
              <StorageRing
                used={instance.storage_used_bytes}
                limit={instance.storage_limit_bytes}
              />
            ) : (
              <StorageUsage
                used={instance.storage_used_bytes}
                limit={instance.storage_limit_bytes}
                variant="sidebar"
              />
            )}
          </div>
        )}

        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={cn(
                  'flex items-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors',
                  embedded ? 'justify-center h-8 w-8' : collapsed ? 'justify-center h-9 w-9 mx-auto' : 'w-full gap-2.5 px-2 py-1.5',
                )}
                aria-label={embedded ? 'FreeFrame settings and account' : undefined}
                title={embedded ? 'FreeFrame settings and account' : collapsed ? (user?.name ?? 'Account') : undefined}
              >
                {embedded ? <Settings className="h-4 w-4" /> : <Avatar src={user?.avatar_url} name={user?.name} size="sm" />}
                {!compact && (
                  <div className="flex flex-col items-start overflow-hidden min-w-0">
                    <span className="truncate text-[13px] font-medium text-text-primary leading-tight w-full text-left">
                      {user?.name ?? 'User'}
                    </span>
                    <span className="truncate text-[10px] text-text-tertiary leading-tight w-full text-left">
                      {user?.email ?? ''}
                    </span>
                  </div>
                )}
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side={embedded ? 'bottom' : 'top'}
                align={embedded ? 'end' : collapsed ? 'start' : 'end'}
                sideOffset={8}
                className="z-50 min-w-[180px] rounded-lg border border-border bg-bg-elevated p-1 shadow-xl animate-slide-up"
              >
                {studioManaged ? <DropdownMenu.Item asChild>
                  <a href="https://app.elasticlabs.site" target="_top"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:outline-none">
                    <User className="h-4 w-4" />
                    Open Studio
                  </a>
                </DropdownMenu.Item> : <><DropdownMenu.Item asChild>
                  <Link
                    href="/settings/profile"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:outline-none"
                  >
                    <User className="h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <Link
                    href={isSuperAdmin ? '/settings/admin' : '/settings/appearance'}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:outline-none"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  onSelect={logout}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-status-error hover:bg-status-error/10 focus:outline-none"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </DropdownMenu.Item>
                </>}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Collapse toggle */}
          {!embedded && <button
            onClick={onToggle}
            className={cn(
              'flex w-full items-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors',
              collapsed ? 'justify-center h-8 w-8 mx-auto' : 'gap-2 px-2.5 h-8',
            )}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronsLeft
              className={cn(
                'h-4 w-4 transition-transform',
                collapsed && 'rotate-180',
              )}
            />
            {!collapsed && <span className="text-xs">Collapse</span>}
          </button>}
        </div>
      </aside>

      {/* Notification Drawer */}
      <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  )
}
