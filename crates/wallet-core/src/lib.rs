use wasm_bindgen::prelude::*;
use js_sys::Math;

// ---- Wallet core stubs ----

/// Initialize the wallet core module.
#[wasm_bindgen]
pub fn init() -> String {
    "wallet-core WASM module loaded successfully".to_string()
}

/// Returns the current version of the wallet core.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Placeholder: will generate a BIP-39 mnemonic in Phase 0.
#[wasm_bindgen]
pub fn generate_mnemonic() -> String {
    "not yet implemented - placeholder for Phase 0".to_string()
}

// ---- Game of Life (canonical Rust WASM demo) ----
// Based on: https://github.com/nicholasray/wasm-game-of-life
//   (from the official Rust and WebAssembly book)

#[wasm_bindgen]
pub struct Universe {
    width: u32,
    height: u32,
    cells: Vec<u8>,
}

#[wasm_bindgen]
impl Universe {
    pub fn new(width: u32, height: u32) -> Universe {
        let cells = (0..width * height)
            .map(|_| if Math::random() < 0.25 { 1 } else { 0 })
            .collect();
        Universe { width, height, cells }
    }

    /// Re-seed with a fresh random state.
    pub fn reset(&mut self) {
        self.cells = (0..self.width * self.height)
            .map(|_| if Math::random() < 0.25 { 1 } else { 0 })
            .collect();
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn cells_ptr(&self) -> *const u8 {
        self.cells.as_ptr()
    }

    /// Spawn live cells in a radius around (col, row).
    pub fn spawn(&mut self, col: i32, row: i32, radius: i32) {
        for dr in -radius..=radius {
            for dc in -radius..=radius {
                if dr * dr + dc * dc > radius * radius { continue; }
                if Math::random() > 0.6 { continue; }
                let r = ((row + dr).rem_euclid(self.height as i32)) as u32;
                let c = ((col + dc).rem_euclid(self.width as i32)) as u32;
                let idx = (r * self.width + c) as usize;
                self.cells[idx] = 1;
            }
        }
    }

    pub fn tick(&mut self) {
        let mut next = self.cells.clone();
        for row in 0..self.height {
            for col in 0..self.width {
                let idx = (row * self.width + col) as usize;
                let cell = self.cells[idx];
                let live_neighbors = self.live_neighbor_count(row, col);
                next[idx] = match (cell, live_neighbors) {
                    (1, x) if x < 2 => 0,
                    (1, 2) | (1, 3) => 1,
                    (1, x) if x > 3 => 0,
                    (0, 3) => 1,
                    (c, _) => c,
                };
            }
        }
        self.cells = next;
    }

    fn live_neighbor_count(&self, row: u32, col: u32) -> u8 {
        let mut count = 0;
        for dr in [self.height - 1, 0, 1] {
            for dc in [self.width - 1, 0, 1] {
                if dr == 0 && dc == 0 { continue; }
                let r = (row + dr) % self.height;
                let c = (col + dc) % self.width;
                count += self.cells[(r * self.width + c) as usize];
            }
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_universe(w: u32, h: u32) -> Universe {
        Universe {
            width: w,
            height: h,
            cells: vec![0; (w * h) as usize],
        }
    }

    #[test]
    fn test_init() {
        assert!(init().contains("loaded successfully"));
    }

    #[test]
    fn test_version() {
        assert_eq!(version(), "0.1.0");
    }

    #[test]
    fn test_universe_creation() {
        let u = make_universe(64, 64);
        assert_eq!(u.width(), 64);
        assert_eq!(u.height(), 64);
    }

    #[test]
    fn test_universe_tick() {
        let mut u = make_universe(10, 10);
        u.tick();
        assert_eq!(u.width(), 10);
    }
}
