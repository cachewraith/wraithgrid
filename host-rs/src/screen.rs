//! What a pane looks like right now, so a client that attaches late gets the real screen
//! (ADR 0001 §3, ADR 0004 §4). The snapshot only has to draw the same screen in xterm.js.

use std::num::NonZeroU16;

/// Same as the renderer's xterm and the Node host's `HOST_SCROLLBACK`.
pub const SCROLLBACK: usize = 5000;

pub struct Screen {
    parser: vt100::Parser,
}

fn dim(n: u16) -> NonZeroU16 {
    NonZeroU16::new(n.max(1)).unwrap_or(NonZeroU16::MIN)
}

impl Screen {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            parser: vt100::Parser::new(dim(rows), dim(cols), SCROLLBACK),
        }
    }

    pub fn write(&mut self, data: &str) {
        self.parser.process(data.as_bytes());
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.parser.screen_mut().set_size(dim(rows), dim(cols));
    }

    /// Escape codes that redraw the active buffer (scrollback included), then the cursor,
    /// the pen and the input modes. Empty for a screen nothing was written to.
    pub fn serialize(&mut self) -> String {
        let screen = self.parser.screen_mut();
        screen.set_scrollback(0);
        let mut rows = String::new();
        // Writing to a String cannot fail.
        let _ = screen.write_contents_formatted_basic(
            &mut rows,
            vt100::capture::BasicFormattedCaptureRange::Full(&mut Default::default()),
        );
        let blank = rows.chars().all(|c| c == '\n');
        if blank && !screen.alternate_screen() && screen.cursor_position() == (0, 0) {
            return String::new();
        }
        let mut out = String::new();
        if screen.alternate_screen() {
            // Only the active buffer is known (ADR 0004, known differences).
            out.push_str("\x1b[?1049h\x1b[H\x1b[2J");
        }
        out.push_str(&rows.replace('\n', "\r\n"));
        out.push_str("\x1b[m");
        out.push_str(&screen.cursor_state_formatted());
        out.push_str(&screen.attributes_formatted());
        out.push_str(&screen.input_mode_formatted());
        out
    }

    /// Plain text of the visible rows, or of the last `lines` rows including scrollback. A row
    /// the terminal wrapped continues the previous line; trailing blank lines are dropped.
    pub fn text(&mut self, lines: Option<usize>) -> String {
        let all = self.all_rows();
        let rows = usize::from(self.parser.screen().size().0.get());
        let end = all.len();
        let start = match lines {
            Some(n) => end.saturating_sub(n),
            None => end.saturating_sub(rows),
        };
        let mut out: Vec<String> = Vec::new();
        let mut prev_wrapped = start > 0 && all[start - 1].1;
        for (text, wrapped) in &all[start..end] {
            if prev_wrapped && !out.is_empty() {
                if let Some(l) = out.last_mut() {
                    l.push_str(text);
                }
            } else {
                out.push(text.clone());
            }
            prev_wrapped = *wrapped;
        }
        while out.last().is_some_and(String::is_empty) {
            out.pop();
        }
        out.join("\n")
    }

    /// Every row of the active buffer, oldest first: its text (trailing blanks trimmed) and
    /// whether it wraps onto the next row.
    fn all_rows(&mut self) -> Vec<(String, bool)> {
        let screen = self.parser.screen_mut();
        let (rows, cols) = screen.size();
        let rows = usize::from(rows.get());
        screen.set_scrollback(usize::MAX);
        let sb = screen.scrollback();
        let total = sb + rows;
        let mut out: Vec<Option<(String, bool)>> = vec![None; total];
        // Each scrollback offset shows `rows` rows; step through them in windows.
        let mut offset = sb;
        loop {
            screen.set_scrollback(offset);
            let first = sb - offset;
            for (i, text) in screen.rows(0, cols.get()).enumerate() {
                let abs = first + i;
                if abs < total && out[abs].is_none() {
                    let wrapped = screen.row_wrapped(i as u16);
                    out[abs] = Some((text.trim_end().to_string(), wrapped));
                }
            }
            if offset == 0 {
                break;
            }
            offset = offset.saturating_sub(rows);
        }
        screen.set_scrollback(0);
        out.into_iter().map(Option::unwrap_or_default).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_the_visible_rows_with_wrapped_lines_joined() {
        let mut s = Screen::new(10, 4);
        s.write("hello\r\n0123456789abc\r\nend");
        assert_eq!(s.text(None), "hello\n0123456789abc\nend");
    }

    #[test]
    fn text_reaches_into_scrollback() {
        let mut s = Screen::new(20, 3);
        for i in 0..10 {
            s.write(&format!("line {i}\r\n"));
        }
        assert_eq!(s.text(None), "line 8\nline 9");
        assert_eq!(s.text(Some(5)), "line 6\nline 7\nline 8\nline 9");
    }

    #[test]
    fn an_untouched_screen_serializes_to_nothing() {
        let mut s = Screen::new(80, 24);
        assert_eq!(s.serialize(), "");
        s.write("x");
        assert!(s.serialize().starts_with('x'));
    }

    #[test]
    fn a_snapshot_redraws_onto_a_fresh_screen() {
        let mut s = Screen::new(20, 5);
        s.write("\x1b[31mred\x1b[m plain\r\n\x1b[1mbold\x1b[m\r\n");
        for i in 0..8 {
            s.write(&format!("row {i}\r\n"));
        }
        s.write("\x1b[?2004h\x1b[3;4H");
        let snap = s.serialize();
        let mut copy = Screen::new(20, 5);
        copy.write(&snap);
        assert_eq!(copy.text(Some(100)), s.text(Some(100)));
        assert_eq!(
            copy.parser.screen().cursor_position(),
            s.parser.screen().cursor_position()
        );
        assert!(copy.parser.screen().bracketed_paste());
        assert_eq!(
            copy.parser.screen().contents_formatted(),
            s.parser.screen().contents_formatted()
        );
    }
}
