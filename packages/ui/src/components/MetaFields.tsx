import { useState, useEffect, useRef } from "react";

// --- SelectChip: custom dropdown replacing native <select> ---

interface SelectChipProps {
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  onChange: (value: string) => void;
}

export function SelectChip({ value, options, placeholder, onChange }: SelectChipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const display = selected?.label || placeholder || "Select";

  return (
    <div className="meta-dropdown" ref={ref}>
      <button
        className={`meta-dropdown-trigger ${!value ? "meta-dropdown-muted" : ""}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {display}
        <svg className="meta-dropdown-chevron" width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
          <path d="M0 0l5 6 5-6z" />
        </svg>
      </button>
      {open && (
        <div className="meta-dropdown-menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={`meta-dropdown-item ${o.value === value ? "meta-dropdown-item-active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
              type="button"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- ComboboxChip: searchable single-select with create ---

interface ComboboxChipProps {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}

export function ComboboxChip({ value, options, placeholder, onChange }: ComboboxChipProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(filter.toLowerCase()),
  );

  useEffect(() => {
    if (!open) { setFilter(""); return; }
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const select = (v: string) => { onChange(v); setOpen(false); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); if (filter.trim()) select(filter.trim()); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="meta-dropdown" ref={containerRef}>
      <button
        className={`meta-dropdown-trigger ${!value ? "meta-dropdown-muted" : ""}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {value || placeholder}
        <svg className="meta-dropdown-chevron" width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
          <path d="M0 0l5 6 5-6z" />
        </svg>
      </button>
      {open && (
        <div className="meta-dropdown-menu">
          <input
            ref={inputRef}
            className="meta-dropdown-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to filter..."
          />
          <div className="meta-dropdown-options">
            <button className="meta-dropdown-item meta-dropdown-muted" onMouseDown={(e) => { e.preventDefault(); select(""); }} type="button">
              {placeholder}
            </button>
            {filtered.map((o) => (
              <button
                key={o}
                className={`meta-dropdown-item ${o === value ? "meta-dropdown-item-active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); select(o); }}
                type="button"
              >
                {o}
              </button>
            ))}
            {filter.trim() && !options.includes(filter.trim()) && (
              <button
                className="meta-dropdown-item meta-dropdown-create"
                onMouseDown={(e) => { e.preventDefault(); select(filter.trim()); }}
                type="button"
              >
                Create &ldquo;{filter.trim()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- MultiComboboxChip: searchable multi-select with create (for tags) ---

interface MultiComboboxChipProps {
  values: string[];
  options: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}

export function MultiComboboxChip({ values, options, placeholder, onChange }: MultiComboboxChipProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(filter.toLowerCase()),
  );

  useEffect(() => {
    if (!open) { setFilter(""); return; }
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const tag = filter.trim().toLowerCase();
      if (tag && !values.includes(tag)) onChange([...values, tag]);
      setFilter("");
    } else if (e.key === "Backspace" && !filter && values.length > 0) {
      onChange(values.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="meta-dropdown" ref={containerRef}>
      <button
        className={`meta-dropdown-trigger ${values.length === 0 ? "meta-dropdown-muted" : ""}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {values.length > 0 ? (
          <span className="meta-tag-pills">
            {values.map((v) => (
              <span key={v} className="meta-tag-pill">
                {v}
                <span
                  className="meta-tag-pill-remove"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(values.filter((x) => x !== v)); }}
                >
                  &times;
                </span>
              </span>
            ))}
          </span>
        ) : placeholder}
        <svg className="meta-dropdown-chevron" width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
          <path d="M0 0l5 6 5-6z" />
        </svg>
      </button>
      {open && (
        <div className="meta-dropdown-menu">
          <input
            ref={inputRef}
            className="meta-dropdown-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to add..."
          />
          <div className="meta-dropdown-options">
            {filtered.map((o) => (
              <button
                key={o}
                className={`meta-dropdown-item ${values.includes(o) ? "meta-dropdown-item-active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
                type="button"
              >
                <span className="meta-dropdown-check">{values.includes(o) ? "\u2713" : ""}</span>
                {o}
              </button>
            ))}
            {filter.trim() && !options.includes(filter.trim().toLowerCase()) && (
              <button
                className="meta-dropdown-item meta-dropdown-create"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const tag = filter.trim().toLowerCase();
                  if (!values.includes(tag)) onChange([...values, tag]);
                  setFilter("");
                }}
                type="button"
              >
                Create &ldquo;{filter.trim().toLowerCase()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- KebabMenu: overflow menu for secondary fields ---

interface KebabMenuItem {
  label: string;
  content: React.ReactNode;
}

export function KebabMenu({ items }: { items: KebabMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="kebab-menu" ref={ref}>
      <button
        className="kebab-trigger"
        onClick={() => setOpen(!open)}
        type="button"
        title="More fields"
        aria-label="More fields"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="kebab-panel">
          {items.map((item) => (
            <div key={item.label} className="kebab-field">
              <span className="kebab-field-label">{item.label}</span>
              {item.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
