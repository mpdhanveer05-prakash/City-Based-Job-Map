"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

// Small building blocks for the admin pages: the same tokens and type as the public site, denser tables (14/20),
// Danger only for destructive actions (design-system.md §5, "Admin workspace").

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A message: `error` is an alert in Danger text with the words; everything else is a polite status. */
export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: React.ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      data-kind={kind}
      className={cn("mb-4 rounded-md border px-3 py-2 text-sm", kind === "error" ? "border-danger text-danger" : "border-rule bg-milky-shade")}
    >
      {children}
    </p>
  );
}

const control =
  "min-h-11 w-full rounded-md border border-field bg-milky px-3 py-2 text-base text-foreground disabled:bg-milky-shade disabled:text-muted-foreground";

type FieldProps = { label: string; error?: string; hint?: string; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode };

/** A label, a control, a hint, and the error next to it. The control comes from `children` so any element can be used. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger" data-testid="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, React.ComponentProps<"input">>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, className)} {...props} />;
});

export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-28", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(control, className)} {...props}>
      {children}
    </select>
  );
}

/** A native checkbox with its label, 44 px tall. */
export function CheckRow({ label, ...props }: { label: string } & Omit<React.ComponentProps<"input">, "type">) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
      <input type="checkbox" className="size-5 accent-ink" {...props} />
      {label}
    </label>
  );
}

/** A dense table with Rule row lines. Scrolls sideways inside its own box on a narrow screen. */
export function DataTable({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto border-y border-rule">
      <table aria-label={label} className="w-full min-w-[40rem] border-collapse text-left text-sm [&_td]:border-t [&_td]:border-rule [&_td]:px-3 [&_td]:py-2 [&_th]:bg-milky-shade [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold">
        {children}
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage(page: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <p className="tabular-nums">
        {total === 0 ? "No rows" : `${page * pageSize + 1} to ${Math.min(total, (page + 1) * pageSize)} of ${total}`}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="min-h-11 rounded-md border-[1.5px] border-foreground px-4 disabled:opacity-40">
          Previous
        </button>
        <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="min-h-11 rounded-md border-[1.5px] border-foreground px-4 disabled:opacity-40">
          Next
        </button>
      </div>
    </nav>
  );
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  unpublished: "Unpublished",
  active: "Active",
  suspect: "Suspect",
  expired: "Expired",
  withdrawn: "Withdrawn",
};
