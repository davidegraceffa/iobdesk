import { Briefcase, ClipboardList, FileSearch, MessagesSquare, Monitor, Moon, Radio, Sun, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { countryName } from '@/lib/format';
import { useProfile, useStats } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Annunci', icon: Briefcase, end: true },
  { to: '/applications', label: 'Candidature', icon: ClipboardList, end: false },
  { to: '/interviews', label: 'Colloqui', icon: MessagesSquare, end: false },
  { to: '/cv-review', label: 'Migliora CV', icon: FileSearch, end: false },
  { to: '/sources', label: 'Fonti', icon: Radio, end: false },
  { to: '/profile', label: 'Profilo', icon: User, end: false },
];

function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Passa al tema ${next === 'dark' ? 'scuro' : 'chiaro'}`}
      title={theme === 'system' ? 'Tema automatico (di sistema)' : undefined}
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu() {
  const { data: profile } = useProfile();
  const { theme, setTheme } = useTheme();
  const country = profile?.settings.user.country;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Menu utente">
          <User />
          <span className="hidden sm:inline">
            {country ? countryName(country, profile?.derived.countryName ?? undefined) : 'Profilo'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          {profile?.settings.profile.title || 'Profilo'}
          {profile && (
            <span className="mt-0.5 block font-normal">
              {profile.derived.timezone} · P.IVA: {profile.settings.user.has_vat_number ? 'sì' : 'no'}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <User /> Profilo e impostazioni
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/profile?tab=cv">CV di default</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        {(
          [
            ['system', 'Automatico', Monitor],
            ['light', 'Chiaro', Sun],
            ['dark', 'Scuro', Moon],
          ] as const
        ).map(([value, label, Icon]) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            aria-checked={theme === value}
            role="menuitemradio"
          >
            <Icon /> {label}
            {theme === value && <span className="ml-auto text-xs text-muted-foreground">attivo</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: stats } = useStats();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-background focus:p-2"
      >
        Vai al contenuto
      </a>
      <aside className="flex shrink-0 items-center gap-1 border-b bg-card px-3 py-2 md:sticky md:top-0 md:h-dvh md:w-52 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <Link to="/" className="mr-2 flex items-center gap-2 rounded-md px-2 py-1 font-semibold md:mr-0 md:mb-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Briefcase className="size-4" />
          </span>
          <span className="hidden sm:inline">Iobdesk</span>
        </Link>
        <nav
          aria-label="Sezioni"
          className="flex flex-1 items-center gap-1 overflow-x-auto md:flex-col md:items-stretch md:overflow-visible"
        >
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {/* sugli schermi stretti restano le icone: tutte le sezioni stanno in una riga */}
              <span className="max-sm:sr-only">{label}</span>
              {to === '/' && stats && stats.newCount > 0 && (
                <span className="ml-auto hidden rounded-full bg-background/70 px-1.5 text-xs text-foreground md:inline">
                  {stats.newCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1 md:mt-auto md:justify-between">
          <ThemeToggle />
          <UserMenu />
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
