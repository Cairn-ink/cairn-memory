import { capabilities, fuseHostedWithCards, OPTIONAL_PORTS } from "../src/index.mjs";
import type { HostedCardChannels } from "../src/index.mjs";
import type {
  CallOptions, DocumentCardCandidates, DocumentCardRecord, LexicalCandidates, LexicalRow, RetrievalScope,
  StorageAdapter, Tx, VectorCandidates, VectorRow,
} from "../src/ports/index.d.ts";
import {
  DOCUMENT_CARD_SEARCH_TEXT_VERSION, documentCardFindItem, documentCardSearchText, visibleDocumentCardRows,
} from "../src/routing/index.mjs";
import type { DocumentCardFindItem, LoadDocumentCardVisibility } from "../src/routing/index.mjs";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type LexicalSignature = Assert<Equal<DocumentCardCandidates["lexical"], LexicalCandidates["lexical"]>>;
type VectorSignature = Assert<Equal<DocumentCardCandidates["vector"], VectorCandidates["vector"]>>;

declare const adapter: StorageAdapter;
declare const tx: Tx;
declare const scope: RetrievalScope;
declare const options: CallOptions;
declare const record: DocumentCardRecord;
declare const loadInput: LoadDocumentCardVisibility;
declare const memoryLexical: readonly LexicalRow[];
declare const memoryVector: readonly VectorRow[];

const flag: "documentCardSearch" = OPTIONAL_PORTS.documentCardCandidates;
const enabled: boolean = capabilities({ documentCards: true, [flag]: true }).documentCardSearch;
const port: DocumentCardCandidates | undefined = adapter.documentCardCandidates;
const version: 1 = DOCUMENT_CARD_SEARCH_TEXT_VERSION;
const indexText: string = documentCardSearchText(record);
const item: DocumentCardFindItem = documentCardFindItem({ ...record, title: null }, "query");
const type: "card" = item.type;

if (enabled && port) {
  const lexical = await port.lexical(tx, scope, "query", 50, options);
  const vector = await port.vector(tx, scope, new Float32Array([1]), "model", 50);
  const { rows: cardLexical, drops } = await visibleDocumentCardRows(lexical.rows, loadInput);
  const missing: number | undefined = drops.missing_input;
  const cardVector = vector.coverage.complete ? (await visibleDocumentCardRows(vector.rows, loadInput)).rows : null;
  const channels: HostedCardChannels = { memoryLexical, memoryVector, cardLexical, cardVector };
  const opts = { offset: 0, limit: 10 };
  fuseHostedWithCards(channels, opts);
  const hybrid = fuseHostedWithCards({ ...channels, memoryVector }, opts);
  const rank: number | null = hybrid.rows[0].vectorRank;
  const lexicalOnly = fuseHostedWithCards({ ...channels, memoryVector: null, cardVector: null }, opts);
  for (const row of lexicalOnly.rows) {
    const score: number = row.score;
  }
}
