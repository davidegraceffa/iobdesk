import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// worker di pdf.js incluso nel bundle (stessa versione usata da react-pdf): nessuna risorsa esterna
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface Props {
  url: string;
  title: string;
  className?: string;
}

/** Anteprima PDF renderizzata nell'app con pdf.js: zoom e navigazione tra le pagine. */
export default function PdfViewer({ url, title, className }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width) - 24));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setError(null);
  }, [url]);

  return (
    <div className={cn('flex min-h-0 flex-col rounded-lg border bg-muted/40', className)}>
      <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5 text-sm">
        <span className="mr-auto truncate px-1 font-medium">{title}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Pagina precedente"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular-nums" aria-live="polite">
          {pages > 0 ? `${page} / ${pages}` : '—'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Pagina successiva"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Riduci zoom"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.round((z - 0.25) * 100) / 100)}
        >
          <ZoomOut />
        </Button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Aumenta zoom"
          disabled={zoom >= 2.5}
          onClick={() => setZoom((z) => Math.round((z + 0.25) * 100) / 100)}
        >
          <ZoomIn />
        </Button>
      </div>
      <div ref={container} className="min-h-80 flex-1 overflow-auto p-3">
        {error ? (
          <p role="alert" className="p-6 text-center text-sm text-destructive">
            Anteprima non disponibile: {error}
          </p>
        ) : (
          <Document
            file={url}
            onLoadSuccess={(doc) => {
              setPages(doc.numPages);
              setPage((p) => Math.min(Math.max(1, p), doc.numPages));
            }}
            onLoadError={(err) => setError(err.message)}
            loading={
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Caricamento dell’anteprima…
              </div>
            }
          >
            <Page
              pageNumber={page}
              width={width * zoom}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="mx-auto w-fit shadow-md"
              loading={null}
            />
          </Document>
        )}
      </div>
    </div>
  );
}
