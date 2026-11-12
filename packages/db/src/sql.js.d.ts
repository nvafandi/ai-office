declare module "sql.js" {
  function initSqlJs(opts?: {
    wasmBinary?: Uint8Array;
    locateFile?: (file: string) => string;
  }): Promise<{ Database: new (buffer?: Uint8Array) => SqlDatabase }>;
  export default initSqlJs;

  export interface SqlDatabase {
    exec(sql: string): void;
    prepare(sql: string): SqlStatement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlStatement {
    run(...params: unknown[]): SqlStatement;
    step(): boolean;
    get(): unknown[] | null;
    bind(...params: unknown[]): SqlStatement;
    reset(): SqlStatement;
    free(): void;
  }
}
