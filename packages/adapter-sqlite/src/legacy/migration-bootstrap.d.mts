export function targetExists(path: string): boolean;
export function cleanMigrationBootstraps(target: string): void;
export function installMigrationTarget(target: string, initialize: (file: string) => Promise<void>): Promise<void>;
