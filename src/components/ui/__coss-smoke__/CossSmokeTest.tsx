/**
 * Phase 1 smoke fixture for coss.ui utility classes.
 *
 * NOT wired into the production UI. See ./README.md for context.
 */

type CossSmokeTestProps = {
  title?: string;
};

export function CossSmokeTest({ title = "coss smoke test" }: CossSmokeTestProps) {
  return (
    <section
      data-testid="coss-smoke-root"
      className="bg-background text-foreground border border-border rounded-md p-4 flex flex-col gap-4"
    >
      <header
        data-testid="coss-smoke-header"
        className="flex flex-col gap-1 font-heading"
      >
        <h2 className="text-foreground text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">
          Renders coss token utility classes only.
        </p>
      </header>

      <div
        data-testid="coss-smoke-card"
        className="bg-card text-card-foreground border border-border rounded-md p-3 flex flex-col gap-2"
      >
        <span className="text-card-foreground">Card surface</span>
        <span className="text-muted-foreground text-xs">
          bg-card / text-card-foreground / border-border
        </span>
      </div>

      <div
        data-testid="coss-smoke-actions"
        className="flex flex-row gap-2"
      >
        <button
          type="button"
          data-testid="coss-smoke-primary"
          className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-sm"
        >
          Primary
        </button>
        <button
          type="button"
          data-testid="coss-smoke-secondary"
          className="bg-secondary text-secondary-foreground rounded-md px-3 py-1 text-sm"
        >
          Secondary
        </button>
        <button
          type="button"
          data-testid="coss-smoke-destructive"
          className="bg-destructive text-destructive-foreground rounded-md px-3 py-1 text-sm"
        >
          Destructive
        </button>
      </div>
    </section>
  );
}
