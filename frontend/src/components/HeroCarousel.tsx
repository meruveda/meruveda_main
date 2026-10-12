"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Banner {
  id: string;
  heading: string;
  subheading?: string;
  cta_text?: string;
  cta_link?: string;
  image_url: string;
}

interface HeroCarouselProps {
  initialBanners?: Banner[];
}

const DEFAULT_BANNERS: Banner[] = [
  {
    id: "default-1",
    heading: "Our Herbal Products",
    subheading:
      "Doctor-formulated Ayurvedic wellness, backed by lab-tested ingredients and inspired by centuries of tradition.",
    cta_text: "Shop Best Sellers",
    cta_link: "/products",
    image_url: "/images/hero_ayurveda.png",
  },
  {
    id: "default-2",
    heading: "Pure & Potent Remedies",
    subheading:
      "Rigorously tested by independent labs for purity. 100% organic, pesticide-free sourcing from nature.",
    cta_text: "Learn Our Quality",
    cta_link: "/about",
    image_url: "/images/ayurvedic_hero_1783843890311.png",
  },
  {
    id: "default-3",
    heading: "Ancient Wisdom, Modern Purity",
    subheading:
      "Liver detox, pain relief, immunity support — authentic Ayurvedic formulas for modern wellness needs.",
    cta_text: "View All Products",
    cta_link: "/products",
    image_url: "/images/banner_liver_detox_2.png",
  },
];

// Returns the modular index safely
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

export default function HeroCarousel({ initialBanners }: HeroCarouselProps) {
  const banners =
    initialBanners && initialBanners.length > 0 ? initialBanners : DEFAULT_BANNERS;
  const total = banners.length;

  const [current, setCurrent] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const goTo = useCallback(
    (idx: number) => {
      if (isAnimating) return;
      setIsAnimating(true);
      setCurrent(mod(idx, total));
      setTimeout(() => setIsAnimating(false), 700);
    },
    [isAnimating, total]
  );

  const goPrev = useCallback(() => goTo(current - 1), [goTo, current]);
  const goNext = useCallback(() => goTo(current + 1), [goTo, current]);

  // Auto-advance
  useEffect(() => {
    if (!isPaused && total > 1) {
      timerRef.current = setInterval(goNext, 5000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPaused, goNext, total]);

  // Touch swipe
  const touchStart = useRef(0);
  const touchEnd = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => { touchStart.current = e.targetTouches[0].clientX; };
  const handleTouchMove = (e: React.TouchEvent) => { touchEnd.current = e.targetTouches[0].clientX; };
  const handleTouchEnd = () => {
    const delta = touchStart.current - touchEnd.current;
    if (delta > 60) goNext();
    if (delta < -60) goPrev();
  };

  // For each banner, compute its visual slot: "prev", "active", "next", or "hidden"
  function getSlot(idx: number): "active" | "prev" | "next" | "hidden" {
    if (idx === current) return "active";
    if (idx === mod(current - 1, total)) return "prev";
    if (idx === mod(current + 1, total)) return "next";
    return "hidden";
  }

  // Slot styles — absolute-positioned, transformed for the coverflow effect
  const slotStyle: Record<
    "active" | "prev" | "next" | "hidden",
    string
  > = {
    // Center slide — full width, full opacity, front
    active:
      "z-20 opacity-100 translate-x-0 scale-100 saturate-100 cursor-default",
    // Left peek — peeking from the left edge, 18% visible, scaled down, dimmed
    prev:
      "z-10 opacity-60 -translate-x-[82%] scale-[0.88] saturate-50 cursor-pointer",
    // Right peek — peeking from the right edge
    next:
      "z-10 opacity-60 translate-x-[82%] scale-[0.88] saturate-50 cursor-pointer",
    // All other slides — hidden behind
    hidden: "z-0 opacity-0 translate-x-0 scale-[0.75] pointer-events-none",
  };

  return (
    <section
      className="relative aspect-[16/7] w-full overflow-hidden bg-[#220330] select-none group"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Slides ─────────────────────────────────────────────────────────── */}
      {banners.map((slide, idx) => {
        const slot = getSlot(idx);
        const isActive = slot === "active";

        return (
          <div
            key={slide.id || idx}
            onClick={() => !isActive && goTo(idx)}
            className={`absolute inset-0 transition-all duration-700 ease-in-out will-change-transform ${slotStyle[slot]}`}
          >
            {/* Background image with subtle ken-burns on active */}
            <div
              className={`absolute inset-0 bg-cover bg-center transition-transform duration-[8000ms] ease-out ${
                isActive ? "scale-[1.04]" : "scale-100"
              }`}
              style={{ backgroundImage: `url(${slide.image_url})` }}
            />

            {/* Dark vignette */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/15 to-[#220330]/85" />

            {/* Peeking-slide gradient overlay for visual depth on side slides */}
            {!isActive && (
              <div className="absolute inset-0 bg-[#220330]/30 pointer-events-none" />
            )}
          </div>
        );
      })}

      {/* ── Mobile-only: simple overlay to disable side-peeks ───────────────
           On md+ the peeks are visible. On mobile they're clipped by overflow-hidden
           and the touch swipe handles navigation instead.                        */}

      {/* ── Prev / Next arrow buttons ───────────────────────────────────────── */}
      {total > 1 && (
        <>
          <button
            onClick={goPrev}
            aria-label="Previous slide"
            className="
              absolute left-2 md:left-5 top-1/2 -translate-y-1/2 z-30
              p-1.5 md:p-2.5 rounded-full
              bg-black/25 hover:bg-[#d4af37] hover:text-[#220330]
              text-white border border-white/15
              backdrop-blur-md
              transition-all duration-300
              hover:scale-110 active:scale-95
              opacity-30 group-hover:opacity-100
            "
          >
            <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
          </button>
          <button
            onClick={goNext}
            aria-label="Next slide"
            className="
              absolute right-2 md:right-5 top-1/2 -translate-y-1/2 z-30
              p-1.5 md:p-2.5 rounded-full
              bg-black/25 hover:bg-[#d4af37] hover:text-[#220330]
              text-white border border-white/15
              backdrop-blur-md
              transition-all duration-300
              hover:scale-110 active:scale-95
              opacity-30 group-hover:opacity-100
            "
          >
            <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
          </button>
        </>
      )}

      {/* ── Dot indicators ─────────────────────────────────────────────────── */}
      {total > 1 && (
        <div className="absolute bottom-3 sm:bottom-8 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5">
          {banners.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goTo(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`rounded-full transition-all duration-300 ${
                idx === current
                  ? "w-8 h-2.5 bg-[#d4af37]"
                  : "w-2.5 h-2.5 bg-white/40 hover:bg-white/70"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
