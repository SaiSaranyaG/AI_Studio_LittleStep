/**
 * Lightweight Client-Side Image Downscaling & Compression Utility
 * 
 * Specifically optimized for LittleStep Space Analyzer & Gemini Vision API:
 * - Downscales large camera photos (e.g. 4032x3024 8MB) to max 1024px while preserving aspect ratio.
 * - Strips heavy EXIF metadata and applies optimal JPEG compression (0.82 quality).
 * - Drastically reduces payload size (>85-95% reduction) and accelerates Gemini vision processing latency.
 * - Provides rich optimization metrics (original size, compressed size, % saved, processing time).
 */

export interface ImageOptimizationOptions {
  /** Maximum width or height in pixels. Default: 1024 (ideal for Gemini Vision token tiles) */
  maxDimension?: number;
  /** JPEG compression quality between 0.1 and 1.0. Default: 0.82 */
  quality?: number;
  /** Output MIME type. Default: 'image/jpeg' */
  format?: 'image/jpeg' | 'image/webp';
  /** Target max file size in bytes (optional second-pass compression) */
  targetMaxBytes?: number;
}

export interface ImageOptimizationResult {
  /** Full Data URL with MIME prefix ready for <img src> or API */
  dataUrl: string;
  /** Raw base64 string without data:image prefix */
  base64: string;
  /** Original image size in bytes */
  originalSizeBytes: number;
  /** Compressed image size in bytes */
  compressedSizeBytes: number;
  /** Number of bytes saved by compression */
  savedBytes: number;
  /** Percentage reduction in payload size (e.g. 88.5) */
  reductionPercentage: number;
  /** Original image dimensions */
  originalWidth: number;
  originalHeight: number;
  /** Compressed image dimensions */
  width: number;
  height: number;
  /** Output MIME type */
  mimeType: string;
  /** Time taken to optimize in milliseconds */
  durationMs: number;
  /** Human-readable optimization summary string */
  summary: string;
}

/**
 * Format bytes into a human-readable string (e.g. "142 KB", "3.2 MB")
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const clampedIndex = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, clampedIndex)).toFixed(dm))} ${sizes[clampedIndex]}`;
}

/**
 * Estimate byte size of a base64 string
 */
export function estimateBase64Bytes(base64OrDataUrl: string): number {
  if (!base64OrDataUrl) return 0;
  const clean = base64OrDataUrl.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '');
  const padding = (clean.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * Load an image source into an HTMLImageElement safely
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to decode image: ${err}`));
    img.src = src;
  });
}

/**
 * Core image optimization function.
 * Accepts a File, Blob, or base64 Data URL and returns an ImageOptimizationResult.
 */
export async function optimizeImageForSpaceAnalysis(
  input: File | Blob | string,
  options: ImageOptimizationOptions = {}
): Promise<ImageOptimizationResult> {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const {
    maxDimension = 1024,
    quality = 0.82,
    format = 'image/jpeg',
    targetMaxBytes,
  } = options;

  // 1. Resolve input to raw data URL and calculate original size
  let rawDataUrl = '';
  let originalSizeBytes = 0;

  if (typeof input === 'string') {
    rawDataUrl = input;
    originalSizeBytes = estimateBase64Bytes(input);
  } else if (input && typeof (input as Blob).size === 'number') {
    const blob = input as Blob;
    originalSizeBytes = blob.size;
    rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(blob);
    });
  } else {
    throw new Error('Unsupported image input format. Expected File, Blob, or base64 string.');
  }

  // Safety check for browser runtime
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    const clean = rawDataUrl.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '');
    return {
      dataUrl: rawDataUrl,
      base64: clean,
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
      savedBytes: 0,
      reductionPercentage: 0,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      mimeType: format,
      durationMs: 0,
      summary: 'Image kept as-is (SSR environment)',
    };
  }

  try {
    // 2. Load into HTML Image
    const img = await loadImage(rawDataUrl);
    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    // 3. Compute aspect-preserved dimensions
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;

    if (originalWidth > maxDimension || originalHeight > maxDimension) {
      if (originalWidth >= originalHeight) {
        targetWidth = maxDimension;
        targetHeight = Math.round((originalHeight * maxDimension) / originalWidth);
      } else {
        targetHeight = maxDimension;
        targetWidth = Math.round((originalWidth * maxDimension) / originalHeight);
      }
    }

    // Ensure minimum dimensions of 1x1
    targetWidth = Math.max(1, targetWidth);
    targetHeight = Math.max(1, targetHeight);

    // 4. Render onto Canvas
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      throw new Error('Canvas 2D context is not supported.');
    }

    // High quality downscaling configuration
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fill white background in case source had transparency
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Draw the image scaled
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // 5. Export compressed data URL
    let currentQuality = quality;
    let compressedDataUrl = canvas.toDataURL(format, currentQuality);
    let compressedSizeBytes = estimateBase64Bytes(compressedDataUrl);

    // Optional second-pass if targetMaxBytes is specified and we exceeded it
    if (targetMaxBytes && compressedSizeBytes > targetMaxBytes && currentQuality > 0.45) {
      currentQuality = Math.max(0.45, currentQuality - 0.2);
      compressedDataUrl = canvas.toDataURL(format, currentQuality);
      compressedSizeBytes = estimateBase64Bytes(compressedDataUrl);
    }

    const cleanBase64 = compressedDataUrl.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '').trim();
    const savedBytes = Math.max(0, originalSizeBytes - compressedSizeBytes);
    const reductionPercentage = originalSizeBytes > 0
      ? Math.max(0, Math.round(((originalSizeBytes - compressedSizeBytes) / originalSizeBytes) * 1000) / 10)
      : 0;

    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.round(endTime - startTime);

    const summary = originalSizeBytes > compressedSizeBytes
      ? `Optimized from ${formatBytes(originalSizeBytes)} to ${formatBytes(compressedSizeBytes)} (${reductionPercentage}% reduction in ${durationMs}ms)`
      : `Image ready: ${formatBytes(compressedSizeBytes)} (${targetWidth}x${targetHeight}px)`;

    return {
      dataUrl: compressedDataUrl,
      base64: cleanBase64,
      originalSizeBytes,
      compressedSizeBytes,
      savedBytes,
      reductionPercentage,
      originalWidth,
      originalHeight,
      width: targetWidth,
      height: targetHeight,
      mimeType: format,
      durationMs,
      summary,
    };
  } catch (err) {
    console.warn('[ImageOptimizer] Client-side downscaling fallback:', err);
    // Safe graceful fallback to original input if anything unexpected happens
    const clean = rawDataUrl.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '');
    const bytes = estimateBase64Bytes(rawDataUrl);
    return {
      dataUrl: rawDataUrl,
      base64: clean,
      originalSizeBytes: bytes,
      compressedSizeBytes: bytes,
      savedBytes: 0,
      reductionPercentage: 0,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      mimeType: 'image/jpeg',
      durationMs: 0,
      summary: 'Optimization bypassed (fallback active)',
    };
  }
}

/**
 * Fast convenience helper that returns just the optimized Data URL string.
 * Drop-in replacement for raw image strings.
 */
export async function compressImageQuick(
  input: File | Blob | string,
  maxDimension: number = 1024,
  quality: number = 0.82
): Promise<string> {
  const res = await optimizeImageForSpaceAnalysis(input, { maxDimension, quality });
  return res.dataUrl;
}
