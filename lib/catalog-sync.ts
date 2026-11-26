import type { AttemptStore } from "./store";
import type { CatalogQuestionInput } from "./rating-store";
import { CatalogSyncManager, type CatalogSyncState } from "./skill-ratings";

export function getCatalogSyncStatus(db: AttemptStore, now = Date.now()): CatalogSyncState & {
  catalogCount: number;
  needsRefresh: boolean;
} {
  const saved = db.ratings.getCatalogSyncState();
  const mgr = new CatalogSyncManager(saved);
  return {
    ...mgr.toJSON(),
    catalogCount: db.ratings.catalogCount(),
    needsRefresh: mgr.needsRefresh(now),
  };
}

export function ingestCatalogSyncPage(
  db: AttemptStore,
  page: { skip: number; totalNum: number; questions: CatalogQuestionInput[] },
  now = Date.now(),
) {
  return db.transaction(() => {
    const saved = db.ratings.getCatalogSyncState();
    const mgr = new CatalogSyncManager(saved);
    const upserted = db.ratings.upsertCatalogPage(page.questions, now);
    const res = mgr.applyPage(
      { totalNum: page.totalNum, count: page.questions.length, skip: page.skip },
      now,
    );
    const state = db.ratings.saveCatalogSyncState(mgr.toJSON());
    return {
      ...state,
      upserted,
      done: res.done,
      catalogCount: db.ratings.catalogCount(),
      needsRefresh: mgr.needsRefresh(now),
    };
  });
}

export function recordCatalogSyncError(db: AttemptStore, error: string, now = Date.now()) {
  const mgr = new CatalogSyncManager(db.ratings.getCatalogSyncState());
  const next = mgr.recordError(error, now);
  db.ratings.saveCatalogSyncState(next);
  return {
    ...next,
    catalogCount: db.ratings.catalogCount(),
    needsRefresh: mgr.needsRefresh(now),
  };
}

export function resetCatalogSync(db: AttemptStore, now = Date.now()) {
  const mgr = new CatalogSyncManager();
  const state = db.ratings.saveCatalogSyncState(mgr.toJSON());
  return {
    ...state,
    catalogCount: db.ratings.catalogCount(),
    needsRefresh: mgr.needsRefresh(now),
  };
}
