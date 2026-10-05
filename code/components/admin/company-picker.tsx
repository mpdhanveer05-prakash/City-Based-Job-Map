"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAdmin } from "./admin-root";
import { TextInput } from "./ui";

export type PickedCompany = { id: string; name: string; domain: string };

/** What a person typed, made safe for a PostgREST `ilike` filter. */
const safeTerm = (q: string) => q.replace(/[,()*%\\:]/g, " ").trim();

/**
 * Chooses one company by typing part of its name or domain (a list of every company would be thousands of rows). Shows
 * the choice, and up to ten matches while typing. The parent keeps the picked company.
 */
export function CompanyPicker({ id, picked, onPick, invalid, describedBy }: { id: string; picked: PickedCompany | null; onPick(company: PickedCompany | null): void; invalid?: boolean; describedBy?: string }) {
  const { supabase } = useAdmin();
  const [text, setText] = useState("");
  const term = safeTerm(text);

  const matches = useQuery({
    queryKey: ["admin", "company-matches", term],
    enabled: term.length >= 2,
    queryFn: async (): Promise<PickedCompany[]> => {
      const { data, error } = await supabase.from("company").select("id, name, domain").or(`name.ilike.%${term}%,domain.ilike.%${term}%`).order("name").limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (picked) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-field bg-milky px-3 py-2" data-testid="picked-company" data-company-id={picked.id}>
        <span>
          {picked.name} <span className="text-sm text-muted-foreground">({picked.domain})</span>
        </span>
        <button type="button" onClick={() => onPick(null)} className="min-h-11 px-2 text-link underline">
          Change
        </button>
      </div>
    );
  }
  return (
    <div>
      <TextInput id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Type part of a name or domain" value={text} onChange={(e) => setText(e.target.value)} data-testid="company-picker" autoComplete="off" />
      {term.length >= 2 && (
        <ul className="mt-1 border border-rule bg-milky" data-testid="company-matches">
          {(matches.data ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-mantis-wash" onClick={() => onPick(c)}>
                <span>{c.name}</span>
                <span className="text-sm text-muted-foreground">{c.domain}</span>
              </button>
            </li>
          ))}
          {matches.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No company matches.</li>}
        </ul>
      )}
    </div>
  );
}

/** Loads one company for the picker when a form opens with an id (an edit, or a link from the company page). */
export function useCompanyById(id: string | null) {
  const { supabase } = useAdmin();
  return useQuery({
    queryKey: ["admin", "company-brief", id],
    enabled: !!id,
    queryFn: async (): Promise<PickedCompany | null> => {
      const { data, error } = await supabase.from("company").select("id, name, domain").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
