/* tslint:disable */
/* eslint-disable */

export class Universe {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cells_ptr(): number;
    height(): number;
    static new(width: number, height: number): Universe;
    /**
     * Re-seed with a fresh random state.
     */
    reset(): void;
    /**
     * Spawn live cells in a radius around (col, row).
     */
    spawn(col: number, row: number, radius: number): void;
    tick(): void;
    width(): number;
}

/**
 * Placeholder: will generate a BIP-39 mnemonic in Phase 0.
 */
export function generate_mnemonic(): string;

/**
 * Initialize the wallet core module.
 */
export function init(): string;

/**
 * Returns the current version of the wallet core.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_universe_free: (a: number, b: number) => void;
    readonly generate_mnemonic: () => [number, number];
    readonly init: () => [number, number];
    readonly universe_cells_ptr: (a: number) => number;
    readonly universe_height: (a: number) => number;
    readonly universe_new: (a: number, b: number) => number;
    readonly universe_reset: (a: number) => void;
    readonly universe_spawn: (a: number, b: number, c: number, d: number) => void;
    readonly universe_tick: (a: number) => void;
    readonly universe_width: (a: number) => number;
    readonly version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
