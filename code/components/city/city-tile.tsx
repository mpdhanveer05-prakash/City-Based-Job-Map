import Link from "next/link";
import { projectCity } from "@/lib/city-art";
import type { CityFiles } from "@/lib/data/city-data";

// Content is left-aligned everywhere (design-system.md §5), so the shape starts at the left padding.
const BOX = { width: 480, height: 280, padding: 24, align: "start" } as const;

/**
 * One city on the selection page (design-system.md §5): the real boundary in Moss with the office
 * points as Mantis dots, the name set large, the company count below. The artwork is decorative
 * (`aria-hidden`); the name and the count are the accessible content. Sample data draws only the
 * outline: synthetic points are never shown as real.
 */
export function CityTile({ city }: { city: CityFiles }) {
  const { synthetic } = city;
  const art = projectCity(
    city.companies.city.boundary,
    synthetic ? [] : city.offices.offices.map((o) => [o.lng, o.lat] as const),
    BOX,
  );
  const companies = city.companies.companies.length;
  const offices = city.offices.offices.length;
  const count = synthetic ? `${companies} sample companies in ${offices} offices` : `${companies} companies in ${offices} offices`;

  return (
    <Link
      href={`/${city.slug}`}
      data-testid={`city-tile-${city.slug}`}
      className="group block bg-background text-foreground no-underline hover:bg-muted"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        preserveAspectRatio="xMinYMid meet"
        className="block h-auto w-full"
        data-testid={`city-art-${city.slug}`}
      >
        <path d={art.path} className="fill-milky-shade stroke-moss" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {art.dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} className="fill-mantis" />
        ))}
      </svg>
      <div className="px-4 pb-6 sm:px-6">
        <h2 className="text-5xl font-extrabold tracking-[-0.02em] sm:text-7xl">{city.companies.city.name}</h2>
        <p className="mt-2 text-sm tabular-nums text-muted-foreground">{count}</p>
      </div>
    </Link>
  );
}
