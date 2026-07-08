import {
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  PDF_ZOOM_STEP,
} from "@client/lib/pdf-preview";
import { Loader2, Minus, Plus } from "lucide-react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

const PAGE_HORIZONTAL_PADDING = 24;
const PAGE_VERTICAL_PADDING = 24;
const ZOOM_BAR_ALLOWANCE = 44;

type PdfCanvasPreviewProps = {
  /** Object URL (or URL) of the PDF to render. */
  src: string;
  /** Accessible label for the rendered document. */
  title: string;
  className?: string;
  /** Show zoom controls (top-right) and render at the chosen zoom level. */
  zoomable?: boolean;
  /**
   * "width" (default) fits each page to the container width (scrolls vertically).
   * "page" fits the whole page inside the container's box so it is fully visible
   * without scrolling — sized for readability, not a thumbnail.
   */
  fit?: "width" | "page";
  /** Starting zoom level (1 = fitted baseline). Only meaningful with `zoomable`. */
  initialZoom?: number;
};

/**
 * Renders a PDF to stacked <canvas> pages with pdf.js. Unlike an <iframe> on a
 * PDF blob (which loads the browser's native viewer, where links are clickable),
 * a canvas render has no annotation layer, so hyperlinks stay inactive — matching
 * the Resume Studio preview. With `zoomable`, a zoom control is shown top-right
 * and scales from the fitted baseline.
 */
export function PdfCanvasPreview({
  src,
  title,
  className,
  zoomable = false,
  fit = "width",
  initialZoom = 1,
}: PdfCanvasPreviewProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [fitWidth, setFitWidth] = useState(0);
  const [fitHeight, setFitHeight] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(initialZoom);

  // Track the available box so a page fits at 100% and zoom scales from there.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const nextWidth = Math.max(
        1,
        viewer.clientWidth - PAGE_HORIZONTAL_PADDING,
      );
      const nextHeight = Math.max(
        1,
        viewer.clientHeight -
          PAGE_VERTICAL_PADDING -
          (zoomable ? ZOOM_BAR_ALLOWANCE : 0),
      );
      setFitWidth((current) => (current === nextWidth ? current : nextWidth));
      setFitHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [zoomable]);

  const zoomFactor = zoomable ? zoomLevel : 1;

  useEffect(() => {
    if (!src || fitWidth <= 1) return;
    if (fit === "page" && fitHeight <= 1) return;
    let cancelled = false;
    let pdf: PDFDocumentProxy | null = null;
    setStatus("loading");

    void (async () => {
      try {
        const data = new Uint8Array(await (await fetch(src)).arrayBuffer());
        if (cancelled) return;
        pdf = await getDocument({ data }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.replaceChildren();

        const outputScale = Math.max(1, window.devicePixelRatio || 1);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;

          const baseViewport = page.getViewport({ scale: 1 });
          const widthScale = fitWidth / baseViewport.width;
          // "page" fit uses the smaller of width/height scale so the entire
          // page lands inside the box; "width" fills the width and scrolls.
          const baseScale =
            fit === "page"
              ? Math.min(widthScale, fitHeight / baseViewport.height)
              : widthScale;
          const scale = Math.max(0.05, baseScale * zoomFactor);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) continue;

          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className =
            "mx-auto mb-4 block rounded-md border border-border/50 bg-white shadow-sm last:mb-0";
          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
          container.appendChild(canvas);

          await page.render({ canvas, canvasContext: context, viewport })
            .promise;
        }

        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      void pdf?.destroy();
    };
  }, [src, fitWidth, fitHeight, zoomFactor, fit]);

  const handleZoomOut = () =>
    setZoomLevel((z) =>
      Math.max(PDF_ZOOM_MIN, Number((z - PDF_ZOOM_STEP).toFixed(2))),
    );
  const handleZoomIn = () =>
    setZoomLevel((z) =>
      Math.min(PDF_ZOOM_MAX, Number((z + PDF_ZOOM_STEP).toFixed(2))),
    );
  const handleZoomReset = () => setZoomLevel(1);

  return (
    <div
      ref={viewerRef}
      className={`relative overflow-auto rounded-md border border-border/50 bg-neutral-200 p-3 dark:bg-neutral-800 ${className ?? ""}`}
    >
      {zoomable ? (
        <div className="sticky top-0 z-10 mb-2 flex justify-end">
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/90 px-1.5 py-1 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomLevel <= PDF_ZOOM_MIN}
              aria-label="Zoom out"
              className="rounded-full p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              disabled={zoomLevel === 1}
              className="min-w-[3rem] rounded-full px-2 py-0.5 text-center text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomLevel >= PDF_ZOOM_MAX}
              aria-label="Zoom in"
              className="rounded-full p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      <div ref={containerRef} aria-label={title} role="document" />
      {status !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {status === "error" ? (
            <span className="text-destructive">
              Could not render the preview.
            </span>
          ) : (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Rendering preview
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
