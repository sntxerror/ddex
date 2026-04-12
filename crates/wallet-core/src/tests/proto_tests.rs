use crate::proto::*;

#[test]
fn test_encode_varint_single_byte() {
    let mut buf = Vec::new();
    encode_varint(&mut buf, 0);
    assert_eq!(buf, vec![0x00]);

    buf.clear();
    encode_varint(&mut buf, 1);
    assert_eq!(buf, vec![0x01]);

    buf.clear();
    encode_varint(&mut buf, 127);
    assert_eq!(buf, vec![0x7f]);
}

#[test]
fn test_encode_varint_multi_byte() {
    let mut buf = Vec::new();
    encode_varint(&mut buf, 128);
    assert_eq!(buf, vec![0x80, 0x01]);

    buf.clear();
    encode_varint(&mut buf, 300);
    assert_eq!(buf, vec![0xac, 0x02]);

    buf.clear();
    encode_varint(&mut buf, u64::MAX);
    assert_eq!(buf.len(), 10);
}

#[test]
fn test_encode_proto_bytes() {
    let mut buf = Vec::new();
    encode_proto_bytes(&mut buf, 1, &[0xAA, 0xBB]);
    assert_eq!(buf, vec![0x0A, 0x02, 0xAA, 0xBB]);
}

#[test]
fn test_encode_varint_field_zero_skipped() {
    let mut buf = Vec::new();
    encode_varint_field(&mut buf, 3, 0);
    assert!(
        buf.is_empty(),
        "varint field with value 0 should not encode"
    );
}

#[test]
fn test_encode_varint_field_nonzero() {
    let mut buf = Vec::new();
    encode_varint_field(&mut buf, 3, 150);
    assert_eq!(buf, vec![0x18, 0x96, 0x01]);
}

#[test]
fn test_encode_fixed64_zero_skipped() {
    let mut buf = Vec::new();
    encode_fixed64(&mut buf, 2, 0);
    assert!(buf.is_empty(), "fixed64 with value 0 should not encode");
}

#[test]
fn test_encode_fixed64_nonzero() {
    let mut buf = Vec::new();
    encode_fixed64(&mut buf, 2, 0x0102030405060708);
    assert_eq!(
        buf,
        vec![0x11, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]
    );
}

#[test]
fn test_encode_submessage() {
    let mut buf = Vec::new();
    let inner = vec![0x01, 0x02, 0x03];
    encode_submessage(&mut buf, 1, &inner);
    assert_eq!(buf, vec![0x0A, 0x03, 0x01, 0x02, 0x03]);
}
