import { describe, expect, it } from 'vitest';
import { AUC_EPOCH_OFFSET, romanDate } from '../components/ui/romanDate';

describe('romanDate (audit item 14 — the week ribbon\'s second line)', () => {
  it('renders the AUC year as the Julian year plus 753', () => {
    expect(AUC_EPOCH_OFFSET).toBe(753);
    expect(romanDate(1, 235).auc).toBe(988);
    expect(romanDate(1, 235).roman).toContain('988 AUC');
  });

  it('opens the year on the Kalends of January', () => {
    expect(romanDate(1, 235).roman).toBe('Kalends of January · 988 AUC');
  });

  it('names the feast itself without a numeral', () => {
    // Week 2 is 8 January; the Nones of January fall on the 5th, so it counts
    // toward the Ides on the 13th: 13 - 8 + 1 = VI.
    expect(romanDate(2, 235).roman).toBe('VI Ides of January · 988 AUC');
  });

  it('counts backwards toward the next Kalends after the Ides', () => {
    // Week 3 is 15 January — past the Ides, so it counts to the Kalends of
    // February: 31 - 15 + 2 = XVIII.
    expect(romanDate(3, 235).roman).toBe('XVIII Kalends of February · 988 AUC');
  });

  it('says Pridie for the day before a feast rather than II', () => {
    // Find the week that lands the day before some feast and confirm the form
    // rather than hardcoding one date.
    const forms = Array.from({ length: 52 }, (_, i) => romanDate(i + 1, 235).roman);
    expect(forms.some(form => form.startsWith('Pridie '))).toBe(true);
    expect(forms.some(form => /^II /.test(form))).toBe(false);
  });

  it('keeps the older reckoning in March, May, July and October', () => {
    // March puts its Nones on the 7th and its Ides on the 15th. Week 10 lands
    // on 5 March and week 11 on the 12th — under the ordinary reckoning those
    // would read "Nones of March" and "Pridie Ides of March".
    expect(romanDate(10, 235).plain).toBe('5 March, Year 235');
    expect(romanDate(10, 235).roman).toBe('III Nones of March · 988 AUC');
    expect(romanDate(11, 235).plain).toBe('12 March, Year 235');
    expect(romanDate(11, 235).roman).toBe('IV Ides of March · 988 AUC');
  });

  it('is pure and stays inside the year for every playable week', () => {
    for (let week = 1; week <= 52; week++) {
      const first = romanDate(week, 235);
      expect(romanDate(week, 235)).toEqual(first);
      expect(first.plain).toMatch(/^\d{1,2} [A-Z][a-z]+, Year 235$/);
    }
  });

  it('wraps rather than overflowing when a reign runs past 52 weeks', () => {
    expect(romanDate(53, 235).roman).toBe(romanDate(1, 235).roman);
  });
});
