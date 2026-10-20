"use client";

/**
 * The country + mobile number field.
 *
 * One component, used everywhere a phone number is asked for: checkout,
 * login, signup, quick login, forgot/reset password, the address book, the
 * order tracking page and the admin customer editor. Having a single field
 * means a customer who is comfortable entering "+971 50 123 4567" on the
 * checkout page is not asked to type an Indian number on the login page.
 *
 * The dropdown is searchable and shows the flag, the country name and the
 * dial code. India is first and the default, with the most common customer
 * countries directly underneath.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  POPULAR_COUNTRY_ISOS,
  type Country,
  detectCountryFromPaste,
  formatDisplay,
  nationalDigits,
} from "@/constants/countries";

interface CountryPhoneFieldProps {
  id: string;
  country: Country;
  onCountryChange: (c: Country) => void;
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  /** Rendered under the input, e.g. a hint about the delivery contact. */
  hint?: React.ReactNode;
}

/** The countries at the top of the list, then everything else, alphabetical. */
function orderedCountries(): Country[] {
  const popular = POPULAR_COUNTRY_ISOS.map((iso) =>
    COUNTRIES.find((c) => c.iso === iso),
  ).filter(Boolean) as Country[];
  const rest = COUNTRIES.filter((c) => !POPULAR_COUNTRY_ISOS.includes(c.iso)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return [...popular, ...rest];
}

export function CountryPhoneField({
  id,
  country,
  onCountryChange,
  value,
  onValueChange,
  disabled,
  invalid,
  placeholder,
  hint,
}: CountryPhoneFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => orderedCountries(), []);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso.includes(q),
    );
  }, [countries, query]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const choose = (c: Country) => {
    onCountryChange(c);
    setOpen(false);
    setQuery("");
  };

  /**
   * Paste handling: a pasted number that already carries a country code
   * switches the country to match, so "+971 50 123 4567" does not end up
   * filed under India.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    const detected = detectCountryFromPaste(text);
    if (detected && detected.country.iso !== country.iso) {
      e.preventDefault();
      onCountryChange(detected.country);
      onValueChange(detected.national);
    }
  };

  const display = country.format
    ? country.format(nationalDigits(value, country))
    : nationalDigits(value, country);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        {/* Country picker */}
        <div ref={wrapRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Country code"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => {
              setOpen((o) => !o);
              setQuery("");
              setActive(0);
            }}
            className={`flex items-center gap-1.5 h-[46px] rounded-xl border bg-white px-3 text-sm text-gray-800 focus:border-gold focus:outline-none disabled:bg-gray-100 ${
              invalid ? "border-red-400" : "border-gray-300"
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {country.flag}
            </span>
            <span className="font-semibold">{country.dial}</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {open && (
            <div className="absolute z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((i) => Math.min(i + 1, options.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      if (options[active]) {
                        e.preventDefault();
                        choose(options[active]);
                      }
                    } else if (e.key === "Escape") {
                      setOpen(false);
                      setQuery("");
                    }
                  }}
                  placeholder="Search country or dial code"
                  className="w-full border-0 text-sm outline-none placeholder-gray-400"
                />
              </div>
              <ul role="listbox" className="max-h-64 overflow-auto py-1">
                {options.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-500">
                    No country matches “{query}”.
                  </li>
                ) : (
                  options.map((c, i) => (
                    <li
                      key={c.iso}
                      role="option"
                      aria-selected={c.iso === country.iso}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(c);
                      }}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                        c.iso === country.iso
                          ? "bg-deep-purple/5 font-semibold text-deep-purple"
                          : i === active
                            ? "bg-gold/15 text-deep-purple"
                            : "text-gray-700"
                      }`}
                    >
                      <span aria-hidden className="text-base leading-none">
                        {c.flag}
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-gray-500">{c.dial}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        {/* National number */}
        <input
          id={id}
          type="tel"
          required
          inputMode="tel"
          autoComplete="tel-national"
          value={display}
          disabled={disabled}
          onPaste={handlePaste}
          onChange={(e) => onValueChange(nationalDigits(e.target.value, country))}
          placeholder={
            placeholder ||
            (country.iso === "in" ? "98765 43210" : `national number (${country.digits} digits)`)
          }
          className={`flex-1 min-w-0 h-[46px] rounded-xl border px-4 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold disabled:bg-gray-100 disabled:text-gray-500 ${
            invalid ? "border-red-400" : "border-gray-300"
          }`}
        />
      </div>

      {/* The full number, so there is never any doubt about what was entered. */}
      {display && (
        <p className="text-[11px] text-gray-400">
          {formatDisplay(value, country)}
        </p>
      )}
      {hint}
    </div>
  );
}

export default CountryPhoneField;
