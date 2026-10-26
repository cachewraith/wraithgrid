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
    ///
    /// Rows are written one by one from a reset pen and reset before each line break: a
    /// line break that scrolls fills the new row with the current background in xterm, so a
    /// row must never end on a coloured pen (#134's dense screens showed it).
    pub fn serialize(&mut self) -> String {
        let rows = self.all_cells();
        let screen = self.parser.screen();
        let alt = screen.alternate_screen();
        let untouched = rows.iter().all(|r| {
            r.cells
                .iter()
                .all(|c| c.text.is_empty() && c.pen == Pen::default())
        });
        if untouched && !alt && screen.cursor_position() == (0, 0) {
            return String::new();
        }
        let mut out = String::new();
        if alt {
            // Only the active buffer is known (ADR 0004, known differences).
            out.push_str("\x1b[?1049h\x1b[H\x1b[2J");
        }
        let mut pen = Pen::default();
        let last_row = rows.len().saturating_sub(1);
        for (i, row) in rows.iter().enumerate() {
            // A wrapped row is written to its full width so the terminal wraps it the same way.
            let end = if row.wrapped {
                row.cells.len()
            } else {
                row.cells
                    .iter()
                    .rposition(|c| !c.text.is_empty() || c.pen != Pen::default())
                    .map_or(0, |p| p + 1)
            };
            for cell in &row.cells[..end] {
                if cell.continuation {
                    continue;
                }
                if cell.pen != pen {
                    cell.pen.write_sgr(&mut out);
                    pen = cell.pen;
                }
                out.push_str(if cell.text.is_empty() {
                    " "
                } else {
                    &cell.text
                });
            }
            if !row.wrapped && i < last_row {
                if pen != Pen::default() {
                    out.push_str("\x1b[m");
                    pen = Pen::default();
                }
                out.push_str("\r\n");
            }
        }
        out.push_str("\x1b[m");
        let screen = self.parser.screen();
        out.push_str(&screen.cursor_state_formatted());
        out.push_str(&screen.attributes_formatted());
        out.push_str(&screen.input_mode_formatted());
        out
    }

    /// Every row of the active buffer with its cells, oldest first.
    fn all_cells(&mut self) -> Vec<Row> {
        let mut out = Vec::new();
        self.walk_rows(|screen, row| {
            let (_, cols) = screen.size();
            let cells = (0..cols.get())
                .map(|col| match screen.cell(row, col) {
                    Some(c) => Cell {
                        text: c.contents().to_string(),
                        continuation: c.is_wide_continuation(),
                        pen: Pen::of(c),
                    },
                    None => Cell::default(),
                })
                .collect();
            out.push(Row {
                cells,
                wrapped: screen.row_wrapped(row),
            });
        });
        out
    }

    /// Calls `f` for every row of the active buffer, oldest first (scrollback, then visible),
    /// with the screen scrolled so that the row is visible at index `row`.
    fn walk_rows(&mut self, mut f: impl FnMut(&vt100::Screen, u16)) {
        let screen = self.parser.screen_mut();
        let rows = usize::from(screen.size().0.get());
        screen.set_scrollback(usize::MAX);
        let sb = screen.scrollback();
        // Each offset shows `rows` rows from scrollback line (sb - offset); step in windows.
        let mut next = 0; // the next absolute row to report
        let mut offset = sb;
        loop {
            screen.set_scrollback(offset);
            let first = sb - offset;
            for i in 0..rows {
                if first + i == next {
                    f(screen, i as u16);
                    next += 1;
                }
            }
            if offset == 0 {
                break;
            }
            offset = offset.saturating_sub(rows);
        }
        screen.set_scrollback(0);
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
        let mut out = Vec::new();
        self.walk_rows(|screen, row| {
            let (_, cols) = screen.size();
            let text = screen
                .rows(0, cols.get())
                .nth(usize::from(row))
                .unwrap_or_default();
            out.push((text.trim_end().to_string(), screen.row_wrapped(row)));
        });
        out
    }
}

#[derive(Default)]
struct Cell {
    text: String,
    /// The right half of a wide character: written with it.
    continuation: bool,
    pen: Pen,
}

struct Row {
    cells: Vec<Cell>,
    wrapped: bool,
}

/// How a cell is drawn.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct Pen {
    fg: vt100::Color,
    bg: vt100::Color,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

impl Pen {
    fn of(c: &vt100::Cell) -> Self {
        Self {
            fg: c.fgcolor(),
            bg: c.bgcolor(),
            bold: c.bold(),
            dim: c.dim(),
            italic: c.italic(),
            underline: c.underline(),
            inverse: c.inverse(),
        }
    }

    /// The whole pen as one SGR from a reset, so it never depends on what came before.
    fn write_sgr(&self, out: &mut String) {
        use std::fmt::Write;
        out.push_str("\x1b[0");
        for (on, code) in [
            (self.bold, 1),
            (self.dim, 2),
            (self.italic, 3),
            (self.underline, 4),
            (self.inverse, 7),
        ] {
            if on {
                let _ = write!(out, ";{code}");
            }
        }
        for (color, base) in [(self.fg, 30u16), (self.bg, 40u16)] {
            match color {
                vt100::Color::Default => {}
                vt100::Color::Idx(n) if n < 8 => {
                    let _ = write!(out, ";{}", base + u16::from(n));
                }
                vt100::Color::Idx(n) if n < 16 => {
                    let _ = write!(out, ";{}", base + 60 + u16::from(n - 8));
                }
                vt100::Color::Idx(n) => {
                    let _ = write!(out, ";{};5;{n}", base + 8);
                }
                vt100::Color::Rgb(r, g, b) => {
                    let _ = write!(out, ";{};2;{r};{g};{b}", base + 8);
                }
            }
        }
        out.push('m');
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
