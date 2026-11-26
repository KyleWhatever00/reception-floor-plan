import { describe, expect, it } from 'vitest';
import { formatFtIn, formatInches, inch, ft, parseLength, parseDegrees, toInches, normalizeAngle, snapTo } from '../src/model/units';

describe('unit conversions', () => {
  it('converts feet and inches to meters exactly', () => {
    expect(ft(1)).toBeCloseTo(0.3048, 10);
    expect(inch(1)).toBeCloseTo(0.0254, 10);
    expect(inch(60)).toBeCloseTo(1.524, 10);
    expect(toInches(1.524)).toBeCloseTo(60, 10);
  });
  it('formats meters as feet and inches', () => {
    expect(formatFtIn(inch(60))).toBe('5′ 0″');
    expect(formatFtIn(inch(66))).toBe('5′ 6″');
    expect(formatFtIn(inch(6))).toBe('6″');
    expect(formatFtIn(inch(11.99), 0.5)).toBe('1′ 0″');
    expect(formatFtIn(-inch(18))).toBe('−1′ 6″');
    expect(formatInches(inch(30))).toBe('30″');
  });
  it('parses many length formats', () => {
    const cases: [string, number][] = [
      ['5', ft(5)], ['5.5', ft(5.5)], ["5' 6\"", ft(5) + inch(6)], ["5'6", ft(5) + inch(6)],
      ['5ft 6in', ft(5) + inch(6)], ['5 ft 6 in', ft(5) + inch(6)], ['5′ 6″', ft(5) + inch(6)],
      ['60in', inch(60)], ['60"', inch(60)], ['60 inches', inch(60)], ['1.5m', 1.5], ['150cm', 1.5],
      ['1500 mm', 1.5], ['-2', -ft(2)], ["5'", ft(5)], ['2,5 m', 2.5],
    ];
    for (const [s, v] of cases) expect(parseLength(s), s).toBeCloseTo(v, 9);
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('5 bananas')).toBeNull();
  });
  it('parses degrees and normalizes angles', () => {
    expect(parseDegrees('90')).toBeCloseTo(Math.PI / 2);
    expect(parseDegrees('-45°')).toBeCloseTo(-Math.PI / 4);
    expect(parseDegrees('x')).toBeNull();
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
  it('snaps to grid', () => {
    expect(snapTo(inch(7), inch(6))).toBeCloseTo(inch(6));
    expect(snapTo(inch(10), inch(6))).toBeCloseTo(inch(12));
  });
});
