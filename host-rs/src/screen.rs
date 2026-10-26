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

/// vt100 never marks a row wrapped on a one-row screen, which would lose the lines when the
/// pane grows again; a pane that small is only ever a hidden or collapsed one, so the host's
/// copy keeps a second row (the program still gets its real size).
/// "Leave the cursor where the re-fed text left it" (see `resize`).
const PARSER_CURSOR: (u16, u16) = (u16::MAX, u16::MAX);

fn rows_dim(n: u16) -> NonZeroU16 {
    dim(n.max(2))
}

impl Screen {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows_dim(rows), dim(cols), SCROLLBACK),
        }
    }

    pub fn write(&mut self, data: &str) {
        self.parser.process(data.as_bytes());
    }

    /// A new size reflows the normal buffer as xterm does: wrapped rows join back into their
    /// lines and wrap again at the new width, so a pane made narrow and wide again keeps its
    /// text. vt100 alone cuts rows at the new width. The alternate screen is not reflowed (nor
    /// is it in xterm).
    pub fn resize(&mut self, cols: u16, rows: u16) {
        let (old_rows, old_cols) = self.parser.screen().size();
        if old_rows == rows_dim(rows) && old_cols == dim(cols) {
            return;
        }
        if self.parser.screen().alternate_screen() {
            self.parser.screen_mut().set_size(rows_dim(rows), dim(cols));
            return;
        }
        let lines = self.logical_lines();
        let old = self.parser.screen();
        let modes = old.input_mode_formatted();
        let pen = old.attributes_formatted();
        let hidden = old.hide_cursor();
        let mut next = vt100::Parser::new(rows_dim(rows), dim(cols), SCROLLBACK);
        let mut cursor = None;
        let mut pen_now = Pen::default();
        let mut buf = String::new();
        for (i, line) in lines.lines.iter().enumerate() {
            if i > 0 {
                if pen_now != Pen::default() {
                    buf.push_str("\x1b[m");
                    pen_now = Pen::default();
                }
                buf.push_str("\r\n");
            }
            let mut at = 0usize;
            for cell in &line.cells {
                if i == lines.cursor_line && at == lines.cursor_offset && cursor.is_none() {
                    next.process(buf.as_bytes());
                    buf.clear();
                    cursor = Some(next.screen().cursor_position());
                }
                if cell.continuation {
                    continue;
                }
                if cell.pen != pen_now {
                    cell.pen.write_sgr(&mut buf);
                    pen_now = cell.pen;
                }
                buf.push_str(if cell.text.is_empty() {
                    " "
                } else {
                    &cell.text
                });
                at += if cell.wide { 2 } else { 1 };
            }
            if i == lines.cursor_line && cursor.is_none() {
                // The cursor sits past the line's text: move there without writing.
                if pen_now != Pen::default() {
                    buf.push_str("\x1b[m");
                    pen_now = Pen::default();
                }
                next.process(buf.as_bytes());
                buf.clear();
                let gap = lines.cursor_offset.saturating_sub(at) as u16;
                if gap == 0 && i + 1 == lines.lines.len() {
                    // Right after the last text: the parser's own cursor is exact, even when
                    // it waits to wrap past the last column, which a move there would undo.
                    cursor = Some(PARSER_CURSOR);
                } else {
                    let (r, c) = next.screen().cursor_position();
                    cursor = Some((r, (c + gap).min(cols.max(1) - 1)));
                }
            }
        }
        buf.push_str("\x1b[m");
        next.process(buf.as_bytes());
        let mut tail = match cursor {
            Some(PARSER_CURSOR) | None => String::new(),
            Some((r, c)) => format!("\x1b[{};{}H", r + 1, c + 1),
        };
        tail.push_str(&pen);
        tail.push_str(&modes);
        if hidden {
            tail.push_str("\x1b[?25l");
        }
        next.process(tail.as_bytes());
        self.parser = next;
    }

    /// The normal buffer as logical lines (wrapped rows joined, trailing blanks dropped), up to
    /// the cursor's line, and where the cursor is: line index and cell offset in that line.
    fn logical_lines(&mut self) -> Lines {
        let rows = self.all_cells();
        let screen = self.parser.screen();
        let visible = usize::from(screen.size().0.get());
        let cols = usize::from(screen.size().1.get());
        let (crow, ccol) = screen.cursor_position();
        let cursor_abs = rows.len().saturating_sub(visible) + usize::from(crow);
        let mut lines: Vec<Line> = Vec::new();
        let mut cur = Line::default();
        let mut start_row = 0;
        let (mut cursor_line, mut cursor_offset) = (0, 0);
        for (abs, row) in rows.into_iter().enumerate() {
            if abs == cursor_abs {
                cursor_line = lines.len();
                cursor_offset = (abs - start_row) * cols + usize::from(ccol);
            }
            let wrapped = row.wrapped;
            cur.cells.extend(row.cells);
            if !wrapped {
                lines.push(std::mem::take(&mut cur));
                start_row = abs + 1;
            }
        }
        if !cur.cells.is_empty() {
            lines.push(cur);
        }
        for line in &mut lines {
            while line
                .cells
                .last()
                .is_some_and(|c| c.text.is_empty() && c.pen == Pen::default() && !c.continuation)
            {
                line.cells.pop();
            }
        }
        // Blank lines after the content and the cursor carry nothing.
        let keep = lines
            .iter()
            .rposition(|l| !l.cells.is_empty())
            .map_or(0, |i| i + 1)
            .max(cursor_line + 1);
        lines.truncate(keep);
        Lines {
            lines,
            cursor_line,
            cursor_offset,
        }
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
        // With no scrollback, rows up to the last with something on it or the cursor's: blank
        // rows below would only scroll the text away in a client whose terminal is still small.
        // With scrollback every row is drawn, so the visible rows line up as they were. xterm's
        // serializer does the same.
        let (vis, _) = screen.size();
        let vis = usize::from(vis.get());
        let (crow, ccol) = screen.cursor_position();
        let cursor_abs = rows.len().saturating_sub(vis) + usize::from(crow);
        let filled = rows
            .iter()
            .rposition(|r| {
                r.cells
                    .iter()
                    .any(|c| !c.text.is_empty() || c.pen != Pen::default())
            })
            .map_or(0, |i| i + 1);
        let shown = if rows.len() > vis {
            rows.len()
        } else {
            filled.max(cursor_abs + 1).min(rows.len())
        };
        let rows = &rows[..shown];
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
        // The cursor, by where the drawn rows end up: top-aligned while they fit, otherwise
        // every row was drawn and the screen is as it was.
        let row = if shown <= vis {
            cursor_abs
        } else {
            usize::from(crow)
        };
        let at_end =
            cursor_abs + 1 == shown && usize::from(ccol) >= usize::from(screen.size().1.get());
        if !at_end {
            let _ = std::fmt::Write::write_fmt(
                &mut out,
                format_args!("\x1b[{};{}H", row + 1, ccol + 1),
            );
        }
        out.push_str(if screen.hide_cursor() {
            "\x1b[?25l"
        } else {
            "\x1b[?25h"
        });
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
                        wide: c.is_wide(),
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

    /// Every row of the active buffer, oldest first: its text and whether it wraps onto the
    /// next row. Like xterm's `translateToString(true)`, only cells never written are trimmed
    /// from the end; a space the program wrote stays.
    fn all_rows(&mut self) -> Vec<(String, bool)> {
        self.all_cells()
            .into_iter()
            .map(|row| {
                let end = row
                    .cells
                    .iter()
                    .rposition(|c| !c.text.is_empty())
                    .map_or(0, |p| p + 1);
                let text: String = row.cells[..end]
                    .iter()
                    .filter(|c| !c.continuation)
                    .map(|c| {
                        if c.text.is_empty() {
                            " "
                        } else {
                            c.text.as_str()
                        }
                    })
                    .collect();
                (text, row.wrapped)
            })
            .collect()
    }
}

#[derive(Default)]
struct Line {
    cells: Vec<Cell>,
}

struct Lines {
    lines: Vec<Line>,
    cursor_line: usize,
    cursor_offset: usize,
}

#[derive(Default)]
struct Cell {
    text: String,
    /// A character two columns wide; its right half follows as a continuation cell.
    wide: bool,
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
    fn narrowing_and_widening_keeps_the_text_like_xterm() {
        let mut s = Screen::new(80, 24);
        s.write("got:secondprompt\r\na-much-longer-line-of-output-here\r\n$ ");
        let before = s.text(Some(50));
        for (c, r) in [(10, 5), (80, 24), (33, 7), (80, 24)] {
            s.resize(c, r);
        }
        assert_eq!(s.text(Some(50)), before);
        // The cursor stays after the prompt.
        assert_eq!(s.parser.screen().cursor_position(), (2, 2));
        s.write("typed");
        assert!(s.text(None).ends_with("$ typed"));
        // Even a collapsed 1x1 pane gives the text back when it grows (the cursor there is
        // checked against xterm by the parity suite).
        let before = s.text(Some(50));
        s.resize(1, 1);
        s.resize(80, 24);
        assert_eq!(s.text(Some(50)), before);
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
