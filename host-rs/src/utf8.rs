//! Pane output arrives in arbitrary chunks; a character split across two reads must come out
//! whole, as node-pty's string decoder does. Invalid bytes become U+FFFD.

#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    /// Decodes `bytes` after what was left over; keeps an incomplete tail for the next call.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let keep = incomplete_tail(&self.pending);
        let cut = self.pending.len() - keep;
        let out = String::from_utf8_lossy(&self.pending[..cut]).into_owned();
        self.pending.drain(..cut);
        out
    }

    /// What is left at the end of the stream, decoded lossily.
    pub fn finish(&mut self) -> String {
        let out = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        out
    }
}

/// How many bytes at the end start a UTF-8 sequence that isn't complete yet (0..=3).
fn incomplete_tail(b: &[u8]) -> usize {
    for back in 1..=3.min(b.len()) {
        let byte = b[b.len() - back];
        if byte & 0b1100_0000 == 0b1000_0000 {
            continue; // continuation byte: look further back for the lead
        }
        let need = if byte & 0b1110_0000 == 0b1100_0000 {
            2
        } else if byte & 0b1111_0000 == 0b1110_0000 {
            3
        } else if byte & 0b1111_1000 == 0b1111_0000 {
            4
        } else {
            return 0;
        };
        return if back < need { back } else { 0 };
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_a_character_split_across_reads() {
        let mut s = Utf8Stream::default();
        let euro = "€".as_bytes(); // 3 bytes
        assert_eq!(s.push(&[b'a', euro[0]]), "a");
        assert_eq!(s.push(&euro[1..2]), "");
        assert_eq!(s.push(&[euro[2], b'b']), "€b");
        let emoji = "😀".as_bytes();
        assert_eq!(s.push(&emoji[..3]), "");
        assert_eq!(s.push(&emoji[3..]), "😀");
    }

    #[test]
    fn invalid_bytes_become_replacement_characters() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.push(&[b'x', 0xff, b'y']), "x\u{fffd}y");
        assert_eq!(s.push(&[0xe2]), "");
        assert_eq!(s.finish(), "\u{fffd}");
    }
}
