/**
 * Browser → object storage, directly (ADR-021): a multipart POST to the presigned target. The
 * API never sees the bytes. XHR (not fetch) because only XHR reports upload progress.
 */
export function uploadToStorage(
  target: { url: string; fields: Record<string, string> },
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(target.fields)) form.append(key, value);
    form.append('file', file); // must be the last field
    const xhr = new XMLHttpRequest();
    xhr.open('POST', target.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              xhr.status === 403
                ? 'Upload link expired or refused'
                : `Upload failed (${xhr.status})`,
            ),
          );
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}
