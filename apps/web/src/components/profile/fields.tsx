import type { Settings } from '@jobagg/shared';
import type { ReactNode } from 'react';
import type { FieldPath, UseFormReturn } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TagInput } from './TagInput';

export type SettingsForm = UseFormReturn<Settings>;
type Path = FieldPath<Settings>;

interface BaseProps {
  form: SettingsForm;
  name: Path;
  label: string;
  description?: ReactNode;
}

export function TextField({ form, name, label, description, placeholder }: BaseProps & { placeholder?: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} value={(field.value as string | undefined) ?? ''} placeholder={placeholder} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function NumberField({
  form,
  name,
  label,
  description,
  min,
  max,
  step,
  suffix,
}: BaseProps & { min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <Input
                type="number"
                inputMode="decimal"
                min={min}
                max={max}
                step={step ?? 1}
                className="max-w-40"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={Number.isFinite(field.value as number) ? (field.value as number) : ''}
                onChange={(e) => field.onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
            </FormControl>
            {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchField({ form, name, label, description, disabled }: BaseProps & { disabled?: boolean }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-1">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </div>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

export function TagsField({ form, name, label, description, placeholder }: BaseProps & { placeholder?: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <TagInput
              value={(field.value as string[] | undefined) ?? []}
              onChange={field.onChange}
              placeholder={placeholder}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CheckboxGroupField<T extends string>({
  form,
  name,
  label,
  description,
  options,
  max,
}: BaseProps & { options: ReadonlyArray<{ value: T; label: string }>; max?: number }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const selected = (field.value as T[] | undefined) ?? [];
        return (
          <FormItem>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm leading-none font-medium">{label}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        disabled={!checked && max !== undefined && selected.length >= max}
                        onCheckedChange={(c) =>
                          field.onChange(
                            c === true ? [...selected, option.value] : selected.filter((v) => v !== option.value),
                          )
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
