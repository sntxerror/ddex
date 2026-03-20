# Build the project
cargo build --target wasm32-unknown-unknown --release
# Generate JavaScript bindings
wasm-bindgen target/wasm32-unknown-unknown/release/wasm.wasm --out-dir pkg --target web