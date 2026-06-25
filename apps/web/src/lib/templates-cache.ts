import { templatesApi } from "./api";
import type { ApiTemplate } from "./types";

let cache: ApiTemplate[] | null = null;
let loadPromise: Promise<ApiTemplate[]> | null = null;

/** Load templates once and reuse across Startup tab mounts. */
export function getTemplatesCached(): Promise<ApiTemplate[]> {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) {
    loadPromise = templatesApi.list().then((templates) => {
      cache = templates;
      return templates;
    });
  }
  return loadPromise;
}

export function findCachedTemplate(id: string): ApiTemplate | undefined {
  return cache?.find((t) => t.id === id);
}

export function invalidateTemplatesCache(): void {
  cache = null;
  loadPromise = null;
}
