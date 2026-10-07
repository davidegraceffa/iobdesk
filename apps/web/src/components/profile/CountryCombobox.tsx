import type { CountryDto } from '@jobagg/shared';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { countryName } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  id?: string;
  countries: CountryDto[];
  value: string | undefined;
  onChange: (code: string) => void;
  invalid?: boolean;
}

/** Select del paese con ricerca (nome italiano, nome inglese o codice ISO). */
export function CountryCombobox({ id, countries, value, onChange, invalid }: Props) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      countries
        .map((c) => ({ ...c, label: countryName(c.code, c.name) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'it')),
    [countries],
  );
  const selected = options.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground')}
        >
          {selected ? `${selected.label} (${selected.code})` : 'Seleziona il paese…'}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        {/* ricerca per sottostringa (non fuzzy): "ital" trova Italia, non Lituania */}
        <Command
          filter={(value, search) => {
            const v = value.toLowerCase();
            const q = search.trim().toLowerCase();
            return v.startsWith(q) ? 1 : v.includes(q) ? 0.5 : 0;
          }}
        >
          <CommandInput placeholder="Cerca un paese…" />
          <CommandList>
            <CommandEmpty>Nessun paese trovato.</CommandEmpty>
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.label} ${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                >
                  <Check className={cn(value === c.code ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1">{c.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.currency}
                    {c.eu ? ' · UE' : ''}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
