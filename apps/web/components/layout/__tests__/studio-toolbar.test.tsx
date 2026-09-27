import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../sidebar'
import { PoweredByBadge } from '@/components/shared/powered-by-badge'
import { useThemeStore } from '@/stores/theme-store'

vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }))
vi.mock('swr', () => ({ default: () => ({ data: undefined }) }))
vi.mock('@/components/shared/branding-provider', () => ({ useBranding: () => ({ orgName: 'FreeFrame', poweredByFreeframe: true }) }))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user: { name: 'Reviewer' }, logout: vi.fn(), isSuperAdmin: true }) }))
vi.mock('@/stores/upload-store', () => ({ useUploadStore: () => ({ files: [], togglePanel: vi.fn(), panelOpen: false }) }))
vi.mock('@/stores/notification-store', () => ({ useNotificationStore: () => ({ unreadCount: 0, fetchNotifications: vi.fn() }) }))
vi.mock('../notification-drawer', () => ({ NotificationDrawer: ({ open }: { open: boolean }) => open ? <div>Notification drawer open</div> : null }))

afterEach(() => {
  cleanup()
  act(() => useThemeStore.getState().setHostTheme(null))
})
describe('FreeFrame in Studio', () => {
  it.each([false, true])('replaces expanded/collapsed sidebar with controls (collapsed=%s)', (collapsed) => {
    act(() => useThemeStore.getState().setHostTheme('dark'))
    render(<Sidebar collapsed={collapsed} onToggle={vi.fn()} />)
    const controls = screen.getByLabelText('Video Reviews controls')
    expect(controls).toHaveClass('flex-row', 'w-full', 'relative')
    expect(controls).not.toHaveClass('fixed', 'h-screen')
    expect(screen.queryByTitle('Collapse sidebar')).not.toBeInTheDocument()
    expect(screen.queryByAltText('FreeFrame')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('button', { name: 'FreeFrame settings and account' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('Notification drawer open')).toBeInTheDocument()
  })
  it('keeps the standalone expanded sidebar', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />)
    expect(screen.getByLabelText('FreeFrame navigation')).toHaveClass('fixed', 'w-[220px]', 'flex-col')
    expect(screen.getByTitle('Collapse sidebar')).toBeInTheDocument()
  })
  it('hides attribution only inside Studio', () => {
    const { rerender } = render(<PoweredByBadge />)
    expect(screen.getByText('Powered by FreeFrame')).toBeInTheDocument()
    act(() => useThemeStore.getState().setHostTheme('light'))
    rerender(<PoweredByBadge />)
    expect(screen.queryByText('Powered by FreeFrame')).not.toBeInTheDocument()
  })
})
