import { APPLICATION_STATUSES, type ApplicationDto, type ApplicationStatus } from '@jobagg/shared';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BellRing,
  ClipboardList,
  Columns3,
  Download,
  FileUp,
  MailCheck,
  MessagesSquare,
  Plus,
  Rows3,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApplicationDetailSheet } from '@/components/applications/ApplicationDetailSheet';
import { ImportApplicationsDialog } from '@/components/applications/ImportApplicationsDialog';
import { StartInterviewDialog } from '@/components/interview/StartInterviewDialog';
import { MailSyncDialog } from '@/components/applications/MailSyncDialog';
import { MailSyncNotice } from '@/components/applications/MailSyncNotice';
import { ManualApplicationDialog } from '@/components/applications/ManualApplicationDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type ApplicationsQuery } from '@/lib/api';
import { APPLICATION_STATUS_LABEL, formatDate } from '@/lib/format';
import { errorMessage, useApplications, useApplicationStats, useProfile, useUpdateApplication } from '@/lib/queries';
import { cn } from '@/lib/utils';

const ALL = '__all__';

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const variant =
    status === 'offer' || status === 'accepted' || status === 'interview'
      ? 'success'
      : status === 'rejected'
        ? 'destructive'
        : status === 'withdrawn' || status === 'no_response' || status === 'skipped'
          ? 'muted'
          : 'secondary';
  return <Badge variant={variant}>{APPLICATION_STATUS_LABEL[status]}</Badge>;
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function SortHeader({
  label,
  sorted,
  onClick,
}: {
  label: string;
  sorted: false | 'asc' | 'desc';
  onClick: () => void;
}) {
  const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
    >
      {label}
      <Icon className={cn('size-3.5', !sorted && 'opacity-40')} />
      <span className="sr-only">
        {sorted === 'asc' ? ' (ordine crescente)' : sorted === 'desc' ? ' (ordine decrescente)' : ''}
      </span>
    </button>
  );
}

/** Vista kanban per stato: le card si spostano trascinandole o con il menu "Sposta in". */
function Kanban({
  applications,
  onOpen,
  onInterview,
}: {
  applications: ApplicationDto[];
  onOpen: (id: string) => void;
  onInterview: (id: string) => void;
}) {
  const update = useUpdateApplication();
  const [dragOver, setDragOver] = useState<ApplicationStatus | null>(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {APPLICATION_STATUSES.map((status) => {
        const items = applications.filter((a) => a.currentStatus === status);
        return (
          <section
            key={status}
            aria-label={APPLICATION_STATUS_LABEL[status]}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(status);
            }}
            onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData('text/plain');
              const app = applications.find((a) => a.id === id);
              if (app && app.currentStatus !== status) update.mutate({ id, patch: { currentStatus: status } });
            }}
            className={cn(
              'flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-muted/40 p-2',
              dragOver === status && 'border-primary bg-accent',
            )}
          >
            <h3 className="flex items-center justify-between px-1 text-sm font-semibold">
              {APPLICATION_STATUS_LABEL[status]}
              <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
            </h3>
            {items.length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">Nessuna candidatura</p>}
            {items.map((app) => (
              <article
                key={app.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', app.id)}
                className="grid cursor-grab gap-1.5 rounded-lg border bg-card p-2.5 text-sm shadow-xs active:cursor-grabbing"
              >
                <button
                  type="button"
                  className="rounded-sm text-left font-medium hover:underline"
                  onClick={() => onOpen(app.id)}
                >
                  {app.snapshot.title}
                </button>
                <div className="text-xs text-muted-foreground">
                  {app.snapshot.company} · {formatDate(app.appliedAt)}
                </div>
                <Button variant="outline" size="sm" className="w-fit" onClick={() => onInterview(app.id)}>
                  <MessagesSquare /> Simula colloquio
                </Button>
                {app.needsFollowUp && (
                  <Badge variant="warning">
                    <BellRing /> Follow-up: {app.daysSinceLastActivity} gg
                  </Badge>
                )}
                <Select
                  value={status}
                  onValueChange={(next) =>
                    update.mutate({ id: app.id, patch: { currentStatus: next as ApplicationStatus } })
                  }
                >
                  <SelectTrigger className="h-7 text-xs" aria-label={`Sposta ${app.snapshot.title} in un altro stato`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLICATION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === status ? APPLICATION_STATUS_LABEL[s] : `Sposta in: ${APPLICATION_STATUS_LABEL[s]}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Storico candidature: riepilogo, filtri, tabella o kanban, dettaglio con timeline, export CSV. */
export function ApplicationsPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState<ApplicationsQuery>({});
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'appliedAt', desc: true }]);
  const openId = params.get('open');
  const setOpenId = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('open', id);
        else next.delete('open');
        return next;
      },
      { replace: true },
    );

  const { data: profile } = useProfile();
  const stats = useApplicationStats();
  const { data, isPending, isError, error } = useApplications(query);
  const applications = useMemo(() => data ?? [], [data]);
  const followupDays = profile?.settings.applications.followup_days ?? 14;
  const sources = useMemo(
    () => [...new Set(applications.map((a) => a.snapshot.sourceName ?? a.snapshot.source))].sort(),
    [applications],
  );
  const countries = useQuery({ queryKey: ['applications', 'countries'], queryFn: api.applications.countries });
  const hasFilters = Object.values(query).some(Boolean);

  const columns = useMemo<ColumnDef<ApplicationDto>[]>(
    () => [
      {
        id: 'appliedAt',
        header: 'Data',
        accessorFn: (a) => a.appliedAt,
        cell: ({ row }) => formatDate(row.original.appliedAt),
      },
      {
        id: 'company',
        header: 'Azienda',
        accessorFn: (a) => a.snapshot.company.toLowerCase(),
        cell: ({ row }) => row.original.snapshot.company,
      },
      {
        id: 'title',
        header: 'Ruolo',
        accessorFn: (a) => a.snapshot.title.toLowerCase(),
        cell: ({ row }) => (
          <button
            type="button"
            className="rounded-sm text-left font-medium hover:underline"
            onClick={() => setOpenId(row.original.id)}
          >
            {row.original.snapshot.title}
          </button>
        ),
      },
      {
        id: 'source',
        header: 'Fonte',
        accessorFn: (a) => a.snapshot.sourceName ?? a.snapshot.source,
        cell: ({ row }) => row.original.snapshot.sourceName ?? row.original.snapshot.source,
      },
      {
        id: 'country',
        header: 'Nazione',
        accessorFn: (a) => a.country ?? '',
        cell: ({ row }) => row.original.country ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'salary',
        header: 'RAL',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.snapshot.salaryFound ? (
            row.original.snapshot.salaryRawText
          ) : (
            <span className="text-muted-foreground">Non indicata</span>
          ),
      },
      {
        id: 'status',
        header: 'Stato',
        accessorFn: (a) => APPLICATION_STATUSES.indexOf(a.currentStatus),
        cell: ({ row }) => <StatusBadge status={row.original.currentStatus} />,
      },
      {
        id: 'activity',
        header: 'Ultima attività',
        accessorFn: (a) => a.daysSinceLastActivity,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {row.original.daysSinceLastActivity} gg
            {row.original.needsFollowUp && (
              <Badge variant="warning" title={`Nessuna risposta da più di ${followupDays} giorni: valuta un follow-up`}>
                <BellRing /> Follow-up
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: 'interview',
        header: () => <span className="sr-only">Colloquio</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Simula il colloquio per ${row.original.snapshot.title}`}
            onClick={() => setInterviewId(row.original.id)}
          >
            <MessagesSquare /> Simula colloquio
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followupDays],
  );

  const table = useReactTable({
    data: applications,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Candidature</h1>
          <p className="text-sm text-muted-foreground">
            Lo storico resta consultabile anche quando gli annunci scadono o vengono rimossi.
          </p>
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Vista">
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            <Rows3 /> Tabella
          </Button>
          <Button
            variant={view === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={view === 'kanban'}
            onClick={() => setView('kanban')}
          >
            <Columns3 /> Kanban
          </Button>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={api.applications.exportUrl(query)} download>
            <Download /> Esporta CSV
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <FileUp /> Importa CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMailOpen(true)}>
          <MailCheck /> Aggiorna da Gmail
        </Button>
        <Button size="sm" onClick={() => setManualOpen(true)}>
          <Plus /> Aggiungi candidatura
        </Button>
      </header>

      <MailSyncNotice onOpen={setOpenId} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Totali" value={stats.data?.total ?? '—'} />
        <StatCard label="Questo mese" value={stats.data?.thisMonth ?? '—'} />
        <StatCard label="Tasso di risposta" value={stats.data ? `${stats.data.responseRate}%` : '—'} />
        <StatCard label="Colloqui" value={stats.data?.interviews ?? '—'} />
        <StatCard label="Offerte" value={stats.data?.offers ?? '—'} />
        <StatCard
          label="Da sollecitare"
          value={stats.data?.needsFollowUp ?? '—'}
          hint={`senza risposta da oltre ${followupDays} gg`}
        />
      </div>

      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Filtri candidature"
      >
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="af-q">Ricerca</Label>
          <Input
            id="af-q"
            type="search"
            placeholder="Ruolo, azienda, note…"
            value={query.q ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value || undefined }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="af-status">Stato</Label>
          <Select
            value={query.status || ALL}
            onValueChange={(v) => setQuery((q) => ({ ...q, status: v === ALL ? undefined : (v as ApplicationStatus) }))}
          >
            <SelectTrigger id="af-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tutti gli stati</SelectItem>
              {APPLICATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {APPLICATION_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="af-source">Fonte</Label>
          <Select
            value={query.source || ALL}
            onValueChange={(v) => setQuery((q) => ({ ...q, source: v === ALL ? undefined : v }))}
          >
            <SelectTrigger id="af-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tutte le fonti</SelectItem>
              {[...new Set([...sources, ...(query.source ? [query.source] : [])])].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="af-from">Dal</Label>
          <Input
            id="af-from"
            type="date"
            value={query.from ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, from: e.target.value || undefined }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="af-to">Al</Label>
          <Input
            id="af-to"
            type="date"
            value={query.to ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, to: e.target.value || undefined }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="af-country">Nazione</Label>
          <Select
            value={query.country || ALL}
            onValueChange={(v) => setQuery((q) => ({ ...q, country: v === ALL ? undefined : v }))}
          >
            <SelectTrigger id="af-country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tutte le nazioni</SelectItem>
              {(countries.data ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="af-company">Azienda</Label>
          <Input
            id="af-company"
            value={query.company ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, company: e.target.value || undefined }))}
          />
        </div>
        {hasFilters && (
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={() => setQuery({})}>
              <X /> Azzera filtri
            </Button>
          </div>
        )}
      </form>

      {isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      ) : applications.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <ClipboardList className="size-8 text-muted-foreground" />
          <h2 className="font-semibold">
            {hasFilters ? 'Nessuna candidatura corrisponde ai filtri' : 'Nessuna candidatura registrata'}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {hasFilters
              ? 'Prova ad allargare il periodo o a togliere qualche filtro.'
              : 'Quando ti candidi a un annuncio, l’app ti chiede di registrarlo qui con una copia dell’annuncio. Puoi anche aggiungere a mano le candidature fatte altrove.'}
          </p>
          {!hasFilters && (
            <Button onClick={() => setManualOpen(true)}>
              <Plus /> Aggiungi candidatura
            </Button>
          )}
        </div>
      ) : view === 'kanban' ? (
        <Kanban applications={applications} onOpen={setOpenId} onInterview={setInterviewId} />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      {header.column.getCanSort() ? (
                        <SortHeader
                          label={String(header.column.columnDef.header)}
                          sorted={header.column.getIsSorted()}
                          onClick={() => header.column.toggleSorting()}
                        />
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className={cn(row.original.needsFollowUp && 'bg-warning/50')}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ApplicationDetailSheet id={openId} onClose={() => setOpenId(null)} />
      <ManualApplicationDialog open={manualOpen} onOpenChange={setManualOpen} />
      <ImportApplicationsDialog open={importOpen} onOpenChange={setImportOpen} />
      <MailSyncDialog open={mailOpen} onOpenChange={setMailOpen} />
      <StartInterviewDialog
        target={interviewId ? { kind: 'application', id: interviewId } : null}
        onClose={() => setInterviewId(null)}
      />
    </div>
  );
}
