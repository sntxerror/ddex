//! Shared protobuf encoding primitives.
//!
//! Manual protobuf encoding matching the wire format spec:
//!   - Wire type 0: Varint (uint64, int64, bool, enum)
//!   - Wire type 1: 64-bit (fixed64, sfixed64, double)
//!   - Wire type 2: Length-delimited (bytes, string, embedded messages)

/// Encode a varint (base-128, little-endian, MSB continuation bit).
pub(crate) fn encode_varint(buf: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            buf.push(byte);
            return;
        }
        buf.push(byte | 0x80);
    }
}

/// Encode a length-delimited field (wire type 2): bytes, string, embedded message.
pub(crate) fn encode_proto_bytes(buf: &mut Vec<u8>, field_number: u32, data: &[u8]) {
    let tag = (field_number << 3) | 2;
    encode_varint(buf, tag as u64);
    encode_varint(buf, data.len() as u64);
    buf.extend_from_slice(data);
}

/// Encode a varint field (wire type 0): uint64, int64, bool, enum.
/// Skips encoding if value is 0 (protobuf default).
pub(crate) fn encode_varint_field(buf: &mut Vec<u8>, field_number: u32, value: u64) {
    if value == 0 {
        return;
    }
    let tag = (field_number << 3) | 0;
    encode_varint(buf, tag as u64);
    encode_varint(buf, value);
}

/// Encode a fixed64 field (wire type 1): fixed64, sfixed64, double.
/// Always encodes 8 bytes little-endian. Skips if value is 0.
pub(crate) fn encode_fixed64(buf: &mut Vec<u8>, field_number: u32, value: u64) {
    if value == 0 {
        return;
    }
    let tag = (field_number << 3) | 1;
    encode_varint(buf, tag as u64);
    buf.extend_from_slice(&value.to_le_bytes());
}

/// Encode an embedded message field (wire type 2). Alias for encode_proto_bytes.
pub(crate) fn encode_submessage(buf: &mut Vec<u8>, field_number: u32, data: &[u8]) {
    encode_proto_bytes(buf, field_number, data);
}

/// Encode a packed repeated fixed64 field (wire type 2, length-delimited).
/// Proto3 default for repeated scalar types.
/// Each value is 8 bytes little-endian, concatenated into a single chunk.
pub(crate) fn encode_packed_fixed64(buf: &mut Vec<u8>, field_number: u32, values: &[u64]) {
    if values.is_empty() {
        return;
    }
    let data_len = values.len() * 8;
    let tag = (field_number << 3) | 2; // wire type 2 = length-delimited
    encode_varint(buf, tag as u64);
    encode_varint(buf, data_len as u64);
    for &v in values {
        buf.extend_from_slice(&v.to_le_bytes());
    }
}
