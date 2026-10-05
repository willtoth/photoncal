export class EngineClient {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (e: Error) => void }
  >();
  onProgress?: (message: string) => void;
  private start() {
    if (this.worker) return;
    this.worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = ({ data }) => {
      if (data.progress) {
        this.onProgress?.(data.progress);
        return;
      }
      const job = this.pending.get(data.id);
      if (!job) return;
      this.pending.delete(data.id);
      data.error ? job.reject(new Error(data.error)) : job.resolve(data.result);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.cancel(new Error(e.message || 'The calibration worker stopped unexpectedly.'));
    };
  }
  call<T = any>(op: string, args: unknown = {}, transfer: Transferable[] = []): Promise<T> {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage(
          { id, op, args, base: new URL(import.meta.env.BASE_URL, location.href).href },
          transfer,
        );
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  cancel(error = new Error('Operation cancelled.')) {
    this.worker?.terminate();
    this.worker = undefined;
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }
}
