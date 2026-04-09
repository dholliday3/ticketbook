import { cn } from "@/lib/utils";

/**
 * Centered message for empty/zero-data panels.
 * Replaces legacy .empty-state / .empty-state-content / .empty-state-title /
 * .empty-state-subtitle / .empty-state-hints / .hint-row from App.css.
 */
export function EmptyState({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center text-muted-foreground",
        className,
      )}
    >
      <div className="text-center">
        <p className="mb-4 text-[15px] text-muted-foreground">{title}</p>
        {subtitle && (
          <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
        )}
        {children && (
          <div className="flex flex-col items-center gap-2 text-xs">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** Single row of a hint cluster, used inside EmptyState. */
export function HintRow({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center justify-center gap-1.5">
      {children}
    </span>
  );
}
