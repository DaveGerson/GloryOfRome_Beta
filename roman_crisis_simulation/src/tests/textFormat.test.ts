import { describe, it, expect } from 'vitest';
import { toSegments } from '../components/textFormat';

describe('toSegments', () => {
  // Injection cases first (RED-GREEN order per TDD plan): these force the
  // escape-by-construction design before any bold-parsing convenience is
  // layered on top.
  describe('injection safety', () => {
    it('returns a raw <script> payload as a single literal, non-bold segment', () => {
      const input = '<script>alert(1)</script>';
      expect(toSegments(input)).toEqual([{ bold: false, text: input }]);
    });

    it('returns an <img onerror> payload as a single literal, non-bold segment', () => {
      const input = '<img src=x onerror=alert(1)>';
      expect(toSegments(input)).toEqual([{ bold: false, text: input }]);
    });

    it('keeps markup INSIDE a bold span as literal text, not parsed markup', () => {
      expect(toSegments('**<b>x</b>**')).toEqual([{ bold: true, text: '<b>x</b>' }]);
    });

    it('decodes HTML entities to literal characters as inert text data (React re-escapes at render, so this stays safe)', () => {
      expect(toSegments('&amp; &lt;')).toEqual([{ bold: false, text: '& <' }]);
    });
  });

  describe('entity decoding', () => {
    it('decodes a named entity embedded in surrounding text', () => {
      expect(toSegments('Marcus &amp; Sons')).toEqual([{ bold: false, text: 'Marcus & Sons' }]);
    });

    it('decodes common named entities', () => {
      expect(toSegments('&lt;&gt;&quot;&apos;&nbsp;')).toEqual([{ bold: false, text: '<>"\' ' }]);
    });

    it('decodes decimal and hexadecimal numeric entities', () => {
      expect(toSegments('&#38; &#x26;')).toEqual([{ bold: false, text: '& &' }]);
    });

    it('decodes uppercase-X hexadecimal numeric entities', () => {
      expect(toSegments('&#X41;')).toEqual([{ bold: false, text: 'A' }]);
    });

    it('keeps entity text that decodes to markup as inert string data, not parsed markup', () => {
      const input = '&lt;script&gt;alert(1)&lt;/script&gt;';
      expect(toSegments(input)).toEqual([{ bold: false, text: '<script>alert(1)</script>' }]);
    });

    it('decodes entities inside bold segments too', () => {
      expect(toSegments('**Marcus &amp; Sons**')).toEqual([{ bold: true, text: 'Marcus & Sons' }]);
    });

    it('leaves unknown or malformed entity-like text unchanged', () => {
      expect(toSegments('AT&T &notarealentity;')).toEqual([{ bold: false, text: 'AT&T &notarealentity;' }]);
    });

    it('does not throw on a numeric entity outside the valid Unicode code point range', () => {
      const input = 'x&#99999999;y';
      expect(() => toSegments(input)).not.toThrow();
      expect(toSegments(input)).toEqual([{ bold: false, text: input }]);
    });
  });

  describe('bold parsing', () => {
    it('returns plain text with no ** as a single non-bold segment', () => {
      expect(toSegments('the senate')).toEqual([{ bold: false, text: 'the senate' }]);
    });

    it('parses a single fully-bold string', () => {
      expect(toSegments('**bold**')).toEqual([{ bold: true, text: 'bold' }]);
    });

    it('parses bold in the middle of plain text', () => {
      expect(toSegments('a **b** c')).toEqual([
        { bold: false, text: 'a ' },
        { bold: true, text: 'b' },
        { bold: false, text: ' c' },
      ]);
    });

    it('alternates correctly across multiple bold spans', () => {
      expect(toSegments('**x** and **y**')).toEqual([
        { bold: true, text: 'x' },
        { bold: false, text: ' and ' },
        { bold: true, text: 'y' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('leaves an unclosed ** as literal text (old regex left it untouched)', () => {
      expect(toSegments('a **b')).toEqual([{ bold: false, text: 'a **b' }]);
    });

    it('does not throw on an empty bold span and produces no markup', () => {
      expect(() => toSegments('****')).not.toThrow();
      expect(toSegments('****')).toEqual([{ bold: true, text: '' }]);
    });

    it('handles the empty string without throwing, rendering nothing', () => {
      expect(toSegments('')).toEqual([]);
    });

    it('coerces non-string input via String(), matching the old md() behavior', () => {
      expect(toSegments(null)).toEqual([{ bold: false, text: 'null' }]);
      expect(toSegments(undefined)).toEqual([{ bold: false, text: 'undefined' }]);
      expect(toSegments(5)).toEqual([{ bold: false, text: '5' }]);
    });

    it('preserves literal newlines in segment text (CSS white-space:pre-wrap renders the break, not a <br>)', () => {
      const segments = toSegments('line1\nline2');
      expect(segments).toEqual([{ bold: false, text: 'line1\nline2' }]);
      expect(segments[0].text).toContain('\n');
    });
  });
});
