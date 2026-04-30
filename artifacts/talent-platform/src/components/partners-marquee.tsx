import { useEffect, useState } from "react";
import {
  useGetPartnerSettings,
  useListPartners,
} from "@workspace/api-client-react";
import { Handshake } from "lucide-react";

/**
 * Public-landing-page "Our Partners" section.
 *
 * Renders nothing when:
 *  - the admin has the section toggled off, OR
 *  - the partners list is empty.
 *
 * Implementation: two identical lists are rendered side-by-side and
 * translated -50% via a CSS keyframe so the strip loops seamlessly
 * with no JS frame work. The animation pauses on hover so users can
 * read a logo they're interested in.
 */
export function PartnersMarquee() {
  const { data: settings } = useGetPartnerSettings();
  const { data: partners } = useListPartners();

  if (!settings?.isActive) return null;
  if (!partners || partners.length === 0) return null;

  return (
    <section className="py-20 bg-muted/30 border-t" data-testid="partners-section">
      <div className="container px-4 md:px-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold flex items-center justify-center gap-2">
            <Handshake className="w-6 h-6 text-primary" />
            Our Partners
          </h2>
          <p className="text-muted-foreground mt-2">
            Trusted by leading institutions and companies.
          </p>
        </div>

        <PartnerMarqueeStrip
          items={partners.map((p) => ({
            id: p.id,
            name: p.name,
            logoUrl: p.logoUrl,
          }))}
        />
      </div>
    </section>
  );
}

type StripItem = { id: number; name: string; logoUrl: string };

function PartnerMarqueeStrip({ items }: { items: StripItem[] }) {
  // Duration scales with item count so the perceived speed stays
  // roughly constant regardless of how many partners the admin adds.
  const seconds = Math.max(20, items.length * 5);
  return (
    <div
      className="relative overflow-hidden group"
      data-testid="partners-marquee"
      style={{
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0, black 80px, black calc(100% - 80px), transparent 100%)",
        maskImage:
          "linear-gradient(to right, transparent 0, black 80px, black calc(100% - 80px), transparent 100%)",
      }}
    >
      <style>{`
        @keyframes partners-marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .partners-marquee-track {
          animation: partners-marquee-scroll linear infinite;
        }
        .group:hover .partners-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .partners-marquee-track {
            animation: none;
            transform: none;
          }
        }
      `}</style>
      <div
        className="partners-marquee-track flex gap-12 w-max"
        style={{ animationDuration: `${seconds}s` }}
      >
        <PartnerRow items={items} />
        <PartnerRow items={items} ariaHidden />
      </div>
    </div>
  );
}

function PartnerRow({
  items,
  ariaHidden = false,
}: {
  items: StripItem[];
  ariaHidden?: boolean;
}) {
  return (
    <ul
      className="flex gap-12 shrink-0"
      aria-hidden={ariaHidden || undefined}
    >
      {items.map((p) => (
        <li
          key={`${ariaHidden ? "dup-" : ""}${p.id}`}
          className="flex items-center justify-center w-40 h-20 shrink-0"
          title={p.name}
          data-testid={ariaHidden ? undefined : `partner-card-${p.id}`}
        >
          <PartnerLogoImage url={p.logoUrl} name={p.name} />
        </li>
      ))}
    </ul>
  );
}

function PartnerLogoImage({ url, name }: { url: string; name: string }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [url]);
  if (errored) {
    return (
      <span className="text-sm font-medium text-muted-foreground text-center px-2">
        {name}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      className="max-w-full max-h-full object-contain opacity-80 hover:opacity-100 transition-opacity"
      onError={() => setErrored(true)}
    />
  );
}
