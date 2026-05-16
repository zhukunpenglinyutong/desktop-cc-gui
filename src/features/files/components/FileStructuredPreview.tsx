import { useMemo } from "react";
import { highlightLine } from "../../../utils/syntax";
import { resolveStructuredPreviewKind } from "../utils/fileRenderProfile";

type FileStructuredPreviewProps = {
  filePath: string;
  value: string;
  className?: string;
};

type ShellSection = {
  notes: string[];
  commands: string[];
};

type DockerInstruction = {
  keyword: string;
  summary: string;
  raw: string;
};

type DockerSection = {
  notes: string[];
  instructions: DockerInstruction[];
};

function renderHighlightedBlock(value: string, language: string | null) {
  return {
    __html: highlightLine(value, language),
  };
}

function parseShellPreview(value: string) {
  const lines = value.split(/\r?\n/);
  const sections: ShellSection[] = [];
  let shebang = "";
  let currentNotes: string[] = [];
  let currentCommands: string[] = [];

  const flushSection = () => {
    if (currentNotes.length === 0 && currentCommands.length === 0) {
      return;
    }
    sections.push({
      notes: currentNotes,
      commands: currentCommands,
    });
    currentNotes = [];
    currentCommands = [];
  };

  lines.forEach((line, index) => {
    if (index === 0 && line.startsWith("#!")) {
      shebang = line;
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushSection();
      return;
    }

    if (trimmed.startsWith("#")) {
      if (currentCommands.length > 0) {
        flushSection();
      }
      currentNotes.push(trimmed.replace(/^#+\s?/, ""));
      return;
    }

    currentCommands.push(line);
  });

  flushSection();

  return { shebang, sections };
}

function parseDockerfilePreview(value: string) {
  const lines = value.split(/\r?\n/);
  const sections: DockerSection[] = [];
  let currentNotes: string[] = [];
  let currentInstructions: DockerInstruction[] = [];
  let pendingInstruction: string[] = [];

  const flushInstructions = () => {
    if (currentNotes.length === 0 && currentInstructions.length === 0) {
      return;
    }
    sections.push({
      notes: currentNotes,
      instructions: currentInstructions,
    });
    currentNotes = [];
    currentInstructions = [];
  };

  const flushPendingInstruction = () => {
    if (pendingInstruction.length === 0) {
      return;
    }
    const raw = pendingInstruction.join("\n");
    const [firstLine] = pendingInstruction;
    if (!firstLine) {
      pendingInstruction = [];
      return;
    }
    const trimmedFirstLine = firstLine.trim();
    const separatorIndex = trimmedFirstLine.indexOf(" ");
    const keyword = (
      separatorIndex > 0
        ? trimmedFirstLine.slice(0, separatorIndex)
        : trimmedFirstLine
    ).toUpperCase();
    const summary = (
      separatorIndex > 0
        ? trimmedFirstLine.slice(separatorIndex + 1)
        : ""
    ).trim();
    currentInstructions.push({
      keyword,
      summary,
      raw,
    });
    pendingInstruction = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPendingInstruction();
      flushInstructions();
      return;
    }

    if (trimmed.startsWith("#")) {
      flushPendingInstruction();
      if (currentInstructions.length > 0) {
        flushInstructions();
      }
      currentNotes.push(trimmed.replace(/^#+\s?/, ""));
      return;
    }

    pendingInstruction.push(line);
    if (!trimmed.endsWith("\\")) {
      flushPendingInstruction();
    }
  });

  flushPendingInstruction();
  flushInstructions();

  return sections;
}

function ShellPreview({
  value,
  className,
}: {
  value: string;
  className: string;
}) {
  const { shebang, sections } = useMemo(() => parseShellPreview(value), [value]);

  return (
    <div className={className} data-testid="file-structured-preview">
      {shebang ? (
        <section className="fvp-structured-preview-banner border border-[color-mix(in_srgb,var(--border-subtle)_78%,transparent)] rounded-xl bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] py-3 px-3.5 flex items-center gap-2.5 font-[var(--code-font-family)] [&_code]:text-[12px] [&_code]:text-(--fvp-reader-text)">
          <div className="fvp-structured-preview-banner-label shrink-0 text-[10px] font-bold tracking-[0.08em] uppercase text-(--fvp-reader-faint)">Shebang</div>
          <code>{shebang}</code>
        </section>
      ) : null}
      {sections.map((section, index) => (
        <section
          key={`shell-${index}`}
          className="fvp-structured-preview-section border border-[color-mix(in_srgb,var(--border-subtle)_78%,transparent)] rounded-xl bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] py-3 px-3.5 flex flex-col gap-2.5"
        >
          {section.notes.length > 0 ? (
            <div className="fvp-structured-preview-notes flex flex-col gap-1.5 text-(--fvp-reader-muted) leading-[1.55] [&_p]:m-0">
              {section.notes.map((note, noteIndex) => (
                <p key={`note-${index}-${noteIndex}`}>{note}</p>
              ))}
            </div>
          ) : null}
          {section.commands.length > 0 ? (
            <div className="fvp-structured-preview-code flex flex-col gap-2.5 [&_pre]:m-0 [&_pre]:py-3 [&_pre]:px-3.5 [&_pre]:overflow-auto [&_pre]:rounded-[10px] [&_pre]:bg-[color-mix(in_srgb,var(--surface-control)_58%,transparent)] [&_pre]:font-[var(--code-font-family)] [&_pre]:text-[12px] [&_pre]:leading-[1.6]">
              <div className="fvp-structured-preview-code-label text-[10px] font-bold tracking-[0.08em] uppercase text-(--fvp-reader-faint)">Commands</div>
              <pre>
                <code
                  dangerouslySetInnerHTML={renderHighlightedBlock(
                    section.commands.join("\n"),
                    "bash",
                  )}
                />
              </pre>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function DockerfilePreview({
  value,
  className,
}: {
  value: string;
  className: string;
}) {
  const sections = useMemo(() => parseDockerfilePreview(value), [value]);

  return (
    <div className={className} data-testid="file-structured-preview">
      {sections.map((section, sectionIndex) => (
        <section
          key={`docker-${sectionIndex}`}
          className="fvp-structured-preview-section border border-[color-mix(in_srgb,var(--border-subtle)_78%,transparent)] rounded-xl bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] py-3 px-3.5 flex flex-col gap-2.5"
        >
          {section.notes.length > 0 ? (
            <div className="fvp-structured-preview-notes flex flex-col gap-1.5 text-(--fvp-reader-muted) leading-[1.55] [&_p]:m-0">
              {section.notes.map((note, noteIndex) => (
                <p key={`docker-note-${sectionIndex}-${noteIndex}`}>{note}</p>
              ))}
            </div>
          ) : null}
          {section.instructions.length > 0 ? (
            <div className="fvp-structured-preview-stack flex flex-col gap-2.5">
              {section.instructions.map((instruction, instructionIndex) => (
                <article
                  key={`docker-instruction-${sectionIndex}-${instructionIndex}`}
                  className="fvp-structured-preview-card border border-[color-mix(in_srgb,var(--border-subtle)_78%,transparent)] rounded-xl bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] py-3 px-3.5"
                >
                  <div className="fvp-structured-preview-card-header flex flex-wrap items-center gap-2.5 mb-2.5">
                    <span className="fvp-structured-preview-pill inline-flex items-center justify-center min-h-[22px] px-2 rounded-full bg-[color-mix(in_srgb,var(--surface-active)_58%,#5fa3ff_12%)] text-(--text-stronger) text-[10px] font-bold tracking-[0.06em] uppercase">
                      {instruction.keyword}
                    </span>
                    {instruction.summary ? (
                      <div className="fvp-structured-preview-summary min-w-0 flex-1 text-(--fvp-reader-text) text-[13px] font-medium leading-[1.45] break-words">
                        {instruction.summary}
                      </div>
                    ) : null}
                  </div>
                  <pre className="fvp-structured-preview-card-code m-0 py-3 px-3.5 overflow-auto rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_58%,transparent)] font-[var(--code-font-family)] text-[12px] leading-[1.6]">
                    <code
                      dangerouslySetInnerHTML={renderHighlightedBlock(
                        instruction.raw,
                        "bash",
                      )}
                    />
                  </pre>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function FileStructuredPreview({
  filePath,
  value,
  className = "fvp-structured-preview",
}: FileStructuredPreviewProps) {
  const previewKind = useMemo(
    () => resolveStructuredPreviewKind(filePath),
    [filePath],
  );

  if (previewKind === "shell") {
    return <ShellPreview value={value} className={className} />;
  }
  if (previewKind === "dockerfile") {
    return <DockerfilePreview value={value} className={className} />;
  }
  return null;
}

export { resolveStructuredPreviewKind };
