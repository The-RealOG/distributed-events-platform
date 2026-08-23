import { ATTACHMENT_CONTENT_TYPES, type AttachmentDto } from '@dpp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { describeError } from '../../lib/api/errors';
import { uploadToStorage } from '../../lib/api/upload';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

const ACCEPT = ATTACHMENT_CONTENT_TYPES.join(',');

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

interface Upload {
  key: string;
  file: File;
  progress: number;
  error?: string | undefined;
}

/**
 * Task attachments. Uploads run in the background of the dialog (never blocking it): request a
 * presigned target → upload straight to storage with progress → ask the API to verify.
 */
export function Attachments({ taskId }: { taskId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const list = useQuery({
    queryKey: queryKeys.taskAttachments(taskId),
    queryFn: ({ signal }) => api.listAttachments(taskId, signal),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.taskAttachments(taskId) });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAttachment(id),
    onSuccess: refresh,
  });

  const patch = (key: string, change: Partial<Upload>) =>
    setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const start = async (upload: Upload) => {
    const { file, key } = upload;
    patch(key, { progress: 0, error: undefined });
    if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      return patch(key, { error: 'This file type is not supported' });
    }
    try {
      const { attachment, upload: target } = await api.requestAttachmentUpload(taskId, {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await uploadToStorage(target, file, (progress) => patch(key, { progress }));
      await api.completeAttachment(attachment.id);
      setUploads((all) => all.filter((u) => u.key !== key));
      await refresh();
    } catch (err) {
      patch(key, {
        error: err instanceof Error && !('kind' in err) ? err.message : describeError(err),
      });
    }
  };

  const onFiles = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const upload = { key: crypto.randomUUID(), file, progress: 0 };
      setUploads((all) => [...all, upload]);
      void start(upload);
    }
    if (input.current) input.current.value = '';
  };

  const download = async (attachment: AttachmentDto) => {
    const { url } = await api.attachmentDownload(attachment.id);
    // The short-lived link is used at once, never stored or shown.
    window.location.assign(url);
  };

  return (
    <section className="stack attachments" aria-labelledby="attachments-heading">
      <div className="attachments-header">
        <h3 id="attachments-heading">Attachments</h3>
        <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()}>
          <Icon name="plus" size={14} /> Attach file
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="visually-hidden"
          aria-label="Choose files to attach"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
      {list.isPending && <Loading label="Loading attachments" />}
      {list.isError && <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />}
      <ul className="attachment-list">
        {list.data?.map((a) => (
          <li key={a.id}>
            <span className="file-icon" aria-hidden="true">
              <Icon name="inbox" size={16} />
            </span>
            <span className="file-body">
              <span className="file-name">{a.filename}</span>
              <span className="muted small">{formatBytes(a.sizeBytes)}</span>
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => void download(a)}>
              Download
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${a.filename}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(a.id)}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
        {uploads.map((u) => (
          <li key={u.key} className={u.error ? 'uploading failed' : 'uploading'}>
            <span className="file-icon" aria-hidden="true">
              <Icon name="inbox" size={16} />
            </span>
            <span className="file-body">
              <span className="file-name">{u.file.name}</span>
              {u.error ? (
                <span role="alert" className="small error-text">
                  {u.error}
                </span>
              ) : (
                <progress max={1} value={u.progress} aria-label={`Uploading ${u.file.name}`} />
              )}
            </span>
            {u.error && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void start(u)}>
                  Retry
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Dismiss ${u.file.name}`}
                  onClick={() => setUploads((all) => all.filter((x) => x.key !== u.key))}
                >
                  <Icon name="x" size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {list.data?.length === 0 && uploads.length === 0 && (
        <p className="muted small">No files yet.</p>
      )}
      {remove.isError && (
        <p role="alert" className="notice notice-error">
          {describeError(remove.error)}
        </p>
      )}
    </section>
  );
}
