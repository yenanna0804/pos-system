export type QueryRow = Record<string, unknown>;

export type TransactionExecutor = {
  query<T extends QueryRow>(sql: string, params?: unknown[]): Promise<T[]>;
};

export abstract class DbService {
  abstract query<T extends QueryRow>(sql: string, params?: unknown[]): Promise<T[]>;
  abstract withTransaction<T>(handler: (executor: TransactionExecutor) => Promise<T>): Promise<T>;
}
