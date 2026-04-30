import { memo, useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import { readLocalImageDataUrl } from "../../services/tauri";

type LocalImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  localPath?: string | null;
  workspaceId?: string | null;
};

function resolveFallbackPath(src: string, localPath?: string | null): string | null {
  if (typeof localPath === "string" && localPath.trim()) {
    return localPath.trim();
  }
  const trimmed = src.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("file://")) {
    const withoutScheme = decodeURIComponent(trimmed.slice("file://".length));
    const hostlessPath = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    if (/^\/[A-Za-z]:[\\/]/.test(hostlessPath)) {
      return hostlessPath.slice(1);
    }
    if (/^[A-Za-z]:[\\/]/.test(hostlessPath)) {
      return hostlessPath;
    }
    return hostlessPath.startsWith("/") ? hostlessPath : `/${hostlessPath}`;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\[^\\]/.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "asset:") {
      const decodedPathname = decodeURIComponent(parsed.pathname ?? "");
      if (/^\/[A-Za-z]:[\\/]/.test(decodedPathname)) {
        return decodedPathname.slice(1);
      }
      return decodedPathname || null;
    }
  } catch {
    return null;
  }
  return null;
}

export const LocalImage = memo(function LocalImage({
  src,
  localPath,
  workspaceId,
  onError,
  ...props
}: LocalImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const fallbackAttemptedRef = useRef(false);

  useEffect(() => {
    setResolvedSrc(src);
    fallbackAttemptedRef.current = false;
  }, [src, localPath, workspaceId]);

  const handleError = useCallback(
    async (event: SyntheticEvent<HTMLImageElement, Event>) => {
      onError?.(event);
      if (fallbackAttemptedRef.current) {
        return;
      }
      if (!workspaceId || !workspaceId.trim()) {
        return;
      }
      const fallbackPath = resolveFallbackPath(resolvedSrc, localPath);
      if (!fallbackPath) {
        return;
      }
      fallbackAttemptedRef.current = true;
      const dataUrl = await readLocalImageDataUrl(workspaceId, fallbackPath);
      if (dataUrl) {
        setResolvedSrc(dataUrl);
      }
    },
    [localPath, onError, resolvedSrc, workspaceId],
  );

  return <img {...props} src={resolvedSrc} onError={handleError} />;
});
