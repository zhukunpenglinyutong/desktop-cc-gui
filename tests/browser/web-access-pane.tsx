// Open /tests/browser/web-access-pane.html with the Vite dev server running.
// Renders the real WebAccessSection inside the settings modal's content pane
// (fixed 720px dialog, scrolling page below) with a mocked IPC surface, so
// relay state flips can be checked for layout shift and for the pairing key
// following a backend-side rotation. No app, no relay, no saved state.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { WebAccessSection } from "../../src/features/settings/WebAccessSection";

function Fixture() {
  return (
    <div className="mx-auto mt-8">
      {/* Same box as the settings Dialog: fixed height, scrolling page pane. */}
      <div className="flex h-[720px] w-[1120px] flex-col overflow-clip rounded-3xl bg-background-full">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div id="pane" className="h-full overflow-y-auto px-8 pb-8 pt-8">
            <WebAccessSection />
            {/* Anything below measures the shift a status line would cause. */}
            <div
              id="tail"
              className="mt-4 h-[420px] rounded-2xl bg-background-secondary-default"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
