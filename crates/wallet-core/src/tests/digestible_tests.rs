use crate::digestible::*;

#[test]
fn test_merlin_digest_basic() {
    let mut d = McDigest::new();
    d.agg_open(b"", b"TestStruct");
    d.uint64_always(b"value", 42);
    d.agg_close(b"", b"TestStruct");
    let hash1 = d.finalize();

    let mut d2 = McDigest::new();
    d2.agg_open(b"", b"TestStruct");
    d2.uint64_always(b"value", 42);
    d2.agg_close(b"", b"TestStruct");
    let hash2 = d2.finalize();

    assert_eq!(hash1, hash2, "Same inputs should produce same hash");

    let mut d3 = McDigest::new();
    d3.agg_open(b"", b"TestStruct");
    d3.uint64_always(b"value", 43);
    d3.agg_close(b"", b"TestStruct");
    let hash3 = d3.finalize();

    assert_ne!(hash1, hash3, "Different inputs should produce different hash");
}

#[test]
fn test_parse_varint() {
    assert_eq!(parse_varint(&[0x00]), Some((0, 1)));
    assert_eq!(parse_varint(&[0x01]), Some((1, 1)));
    assert_eq!(parse_varint(&[0x7f]), Some((127, 1)));
    assert_eq!(parse_varint(&[0x80, 0x01]), Some((128, 2)));
    assert_eq!(parse_varint(&[0xac, 0x02]), Some((300, 2)));
}

#[test]
fn test_parse_proto_fields() {
    let data = vec![0x0A, 0x02, 0xAA, 0xBB];
    let fields = parse_proto_fields(&data);
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].field_number, 1);
    assert_eq!(fields[0].wire_type, 2);
    assert_eq!(fields[0].data, &[0xAA, 0xBB]);
}
