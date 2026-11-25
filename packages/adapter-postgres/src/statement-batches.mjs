export const READ_BEGIN = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
export const LOCK_TIMEOUT = "5s";
export const LOCAL_LOCK_TIMEOUT = `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`;
export const LOCAL_STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '30s'";
export const READ_START_BATCH = `${READ_BEGIN}; ${LOCAL_LOCK_TIMEOUT}; ${LOCAL_STATEMENT_TIMEOUT}`;
export const WRITE_START_BATCH = `BEGIN; ${LOCAL_LOCK_TIMEOUT}; ${LOCAL_STATEMENT_TIMEOUT}`;

export const HNSW_ITERATIVE_SCAN = "SET LOCAL hnsw.iterative_scan = 'strict_order'";
export const READ_SORT = "SELECT current_setting('enable_sort') AS enable_sort";
export const DISABLE_SORT = "SET LOCAL enable_sort = off";
export const RESTORE_SORT = "SET LOCAL enable_sort = on";
export const ANN_SETUP_BATCH = `${HNSW_ITERATIVE_SCAN}; ${READ_SORT}; ${DISABLE_SORT}`;
