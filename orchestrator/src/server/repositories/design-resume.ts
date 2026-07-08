import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "../db/index";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const { designResumeAssets, designResumeDocuments } = schema;

function documentsScopeFilter() {
  return privateDataScopeFilter(designResumeDocuments);
}

function assetsScopeFilter() {
  return privateDataScopeFilter(designResumeAssets);
}

/**
 * The primary master (English / untagged). Deterministic: never returns a
 * language-specific master, so editing a German master can't hijack the
 * default used by the profile, tailoring and English renders.
 *
 * Named "latest" for historical callers; it now filters to the primary before
 * ordering by updatedAt (there is normally exactly one primary row).
 */
export async function getLatestDesignResumeDocument() {
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(
      and(
        documentsScopeFilter(),
        or(
          isNull(designResumeDocuments.language),
          eq(designResumeDocuments.language, "english"),
        ),
      ),
    )
    .orderBy(desc(designResumeDocuments.updatedAt))
    .limit(1);
  return row ?? null;
}

/** The master hand-authored for a specific language, or null if none exists. */
export async function getDesignResumeDocumentForLanguage(language: string) {
  if (language === "english") {
    return getLatestDesignResumeDocument();
  }
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(
      and(documentsScopeFilter(), eq(designResumeDocuments.language, language)),
    )
    .orderBy(desc(designResumeDocuments.updatedAt))
    .limit(1);
  return row ?? null;
}

/** Lightweight list of all masters (primary + language variants) for the UI switcher. */
export async function listDesignResumeMasters() {
  return db
    .select({
      id: designResumeDocuments.id,
      title: designResumeDocuments.title,
      language: designResumeDocuments.language,
      updatedAt: designResumeDocuments.updatedAt,
    })
    .from(designResumeDocuments)
    .where(documentsScopeFilter())
    .orderBy(desc(designResumeDocuments.updatedAt));
}

export async function getDesignResumeDocumentById(id: string) {
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(and(documentsScopeFilter(), eq(designResumeDocuments.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listDesignResumeAssets(documentId: string) {
  return db
    .select()
    .from(designResumeAssets)
    .where(
      and(assetsScopeFilter(), eq(designResumeAssets.documentId, documentId)),
    )
    .orderBy(desc(designResumeAssets.updatedAt));
}

export async function getDesignResumeAssetById(id: string) {
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(and(assetsScopeFilter(), eq(designResumeAssets.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getDesignResumeAssetByIdAnyTenant(id: string) {
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(eq(designResumeAssets.id, id))
    .limit(1);
  return row ?? null;
}

export async function upsertDesignResumeDocument(input: {
  id: string;
  title: string;
  resumeJson: Record<string, unknown>;
  revision: number;
  sourceResumeId: string | null;
  sourceMode: string | null;
  importedAt: string | null;
  language?: string | null;
  createdAt?: string;
  updatedAt: string;
}) {
  const scope = getPrivateDataScope();
  const existing = await getDesignResumeDocumentById(input.id);
  if (existing) {
    await db
      .update(designResumeDocuments)
      .set({
        title: input.title,
        resumeJson: input.resumeJson,
        revision: input.revision,
        sourceResumeId: input.sourceResumeId,
        sourceMode: input.sourceMode,
        importedAt: input.importedAt,
        // Keep the existing tag unless the caller explicitly sets one.
        language:
          input.language !== undefined ? input.language : existing.language,
        updatedAt: input.updatedAt,
      })
      .where(
        and(documentsScopeFilter(), eq(designResumeDocuments.id, input.id)),
      );
  } else {
    await db.insert(designResumeDocuments).values({
      id: input.id,
      tenantId: scope.tenantId,
      userId: scope.userId,
      title: input.title,
      resumeJson: input.resumeJson,
      revision: input.revision,
      sourceResumeId: input.sourceResumeId,
      sourceMode: input.sourceMode,
      importedAt: input.importedAt,
      language: input.language ?? null,
      createdAt: input.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    });
  }

  return getDesignResumeDocumentById(input.id);
}

export async function insertDesignResumeAsset(input: {
  id: string;
  documentId: string;
  kind: "picture";
  originalName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  createdAt?: string;
  updatedAt: string;
}) {
  const scope = getPrivateDataScope();
  await db.insert(designResumeAssets).values({
    id: input.id,
    tenantId: scope.tenantId,
    userId: scope.userId,
    documentId: input.documentId,
    kind: input.kind,
    originalName: input.originalName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    storagePath: input.storagePath,
    createdAt: input.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
  });

  return getDesignResumeAssetById(input.id);
}

export async function deleteDesignResumeAsset(id: string) {
  await db
    .delete(designResumeAssets)
    .where(and(assetsScopeFilter(), eq(designResumeAssets.id, id)));
}

export async function deleteDesignResumeAssetsForDocument(documentId: string) {
  await db
    .delete(designResumeAssets)
    .where(
      and(assetsScopeFilter(), eq(designResumeAssets.documentId, documentId)),
    );
}

export async function deleteDesignResumeDocument(id: string) {
  await db
    .delete(designResumeDocuments)
    .where(and(documentsScopeFilter(), eq(designResumeDocuments.id, id)));
}

export async function findDesignResumeAssetForDocument(args: {
  documentId: string;
  kind: "picture";
}) {
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.documentId, args.documentId),
        assetsScopeFilter(),
        eq(designResumeAssets.kind, args.kind),
      ),
    )
    .limit(1);
  return row ?? null;
}
