use blake3::Hasher;

pub struct ChecksumCalculator;

impl ChecksumCalculator {
    #[allow(clippy::too_many_arguments)]
    pub fn calculate(
        previous_checksum: Option<&str>,
        stream_id: &str,
        stream_sequence: u64,
        event_id: &str,
        event_type: &str,
        event_version: u16,
        payload_bytes: &[u8],
        metadata_bytes: &[u8],
    ) -> String {
        let mut hasher = Hasher::new();

        // Versioned framing
        hasher.update(b"v1\n");
        if let Some(prev) = previous_checksum {
            hasher.update(prev.as_bytes());
        }
        hasher.update(b"\n");
        hasher.update(stream_id.as_bytes());
        hasher.update(b"\n");
        hasher.update(&stream_sequence.to_le_bytes());
        hasher.update(b"\n");
        hasher.update(event_id.as_bytes());
        hasher.update(b"\n");
        hasher.update(event_type.as_bytes());
        hasher.update(b"\n");
        hasher.update(&event_version.to_le_bytes());
        hasher.update(b"\n");
        hasher.update(payload_bytes);
        hasher.update(b"\n");
        hasher.update(metadata_bytes);

        hasher.finalize().to_hex().to_string()
    }
}
