import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { signIn, signUp } from '../../lib/auth'

interface Props {
  open: boolean
  onClose: () => void
  onSignedIn: () => void
}

export function SignInDialog({ open, onClose, onSignedIn }: Props) {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signUp') {
        await signUp(email.trim(), password)
      } else {
        await signIn(email.trim(), password)
      }
      onSignedIn()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-full max-w-sm bg-panel border border-border rounded-lg shadow-lg p-5',
            'focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {mode === 'signUp' ? 'Create account' : 'Sign in'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-xs text-muted-foreground mb-4">
            Sign in to share vaults with a team.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
              className={cn(
                'w-full h-9 px-3 text-sm bg-surface border border-border rounded-md',
                'text-foreground placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-1 focus:ring-accent',
              )}
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              className={cn(
                'w-full h-9 px-3 text-sm bg-surface border border-border rounded-md',
                'text-foreground placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-1 focus:ring-accent',
              )}
            />

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setMode(m => (m === 'signUp' ? 'signIn' : 'signUp'))}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {mode === 'signUp' ? 'Have an account? Sign in' : 'New here? Create an account'}
              </button>
              <button
                type="submit"
                disabled={busy || !email.trim() || !password}
                className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {busy ? 'Please wait…' : mode === 'signUp' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
