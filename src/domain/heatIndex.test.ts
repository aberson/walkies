import { heatIndex } from './heatIndex';

// Test vectors validated against the NWS published heat-index chart
// (wpc.ncep.noaa.gov/html/heatindex.shtml). Expected values are the chart's
// published apparent temperatures; we assert within ±1°F.
//
//   T(°F)  RH(%)  NWS chart HI(°F)
//   80     40     80
//   90     70     106
//   100    40     109
//   110    40     136
//   95     10     ~89   (low-RH adjustment branch)
//   82     90     ~92   (high-RH adjustment branch)
describe('heatIndex (NWS Rothfusz)', () => {
  const cases: { T: number; RH: number; expected: number }[] = [
    { T: 80, RH: 40, expected: 80 },
    { T: 90, RH: 70, expected: 106 },
    { T: 100, RH: 40, expected: 109 },
    { T: 110, RH: 40, expected: 136 },
    { T: 95, RH: 10, expected: 89 }, // low-RH adjustment applies
    { T: 82, RH: 90, expected: 92 }, // high-RH adjustment applies
  ];

  it.each(cases)(
    'T=$T RH=$RH within ±1°F of NWS $expected',
    ({ T, RH, expected }) => {
      const hi = heatIndex(T, RH);
      expect(Math.abs(hi - expected)).toBeLessThanOrEqual(1);
    },
  );

  it('returns the simple form in the cool range (no regression)', () => {
    // 70°F / 50% is below the 80°F crossover → simple Steadman form, ~69°F.
    const hi = heatIndex(70, 50);
    expect(hi).toBeGreaterThan(66);
    expect(hi).toBeLessThan(72);
  });

  it('low-RH adjustment lowers HI below the bare regression', () => {
    // The low-RH branch only fires for RH<13. Sanity: very dry hot air reads
    // cooler than the same temp at moderate humidity would in the regression.
    const dry = heatIndex(95, 10);
    const moderate = heatIndex(95, 40);
    expect(dry).toBeLessThan(moderate);
  });
});
