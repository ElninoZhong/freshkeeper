import type { Adapter } from './types.js';

export class Registry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  list(): Adapter[] {
    return Array.from(this.adapters.values());
  }
}
