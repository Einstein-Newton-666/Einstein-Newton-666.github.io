const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slides,
  resolveTimePeriod,
  resolveHomeSceneIndex,
} = require('../source/js/anime-home-scenes.js');

function localDate(hour, minute = 0) {
  return new Date(2026, 7, 26, hour, minute, 0, 0);
}

test('按本地时间边界返回四个首页时段', () => {
  const cases = [
    [localDate(4, 59), 'night'],
    [localDate(5), 'morning'],
    [localDate(10, 59), 'morning'],
    [localDate(11), 'day'],
    [localDate(16, 59), 'day'],
    [localDate(17), 'sunset'],
    [localDate(19, 59), 'sunset'],
    [localDate(20), 'night'],
  ];

  for (const [date, expected] of cases) {
    assert.equal(resolveTimePeriod(date), expected);
  }
});

test('无效日期回退到白日场景', () => {
  assert.equal(resolveTimePeriod(new Date(Number.NaN)), 'day');
  assert.equal(resolveHomeSceneIndex(new Date(Number.NaN)), 1);
});

test('四个场景使用互不重复的三档本地资源', () => {
  assert.deepEqual(slides.map((slide) => slide.period), [
    'morning',
    'day',
    'sunset',
    'night',
  ]);
  for (const slide of slides) {
    assert.match(slide.src, /^\/images\/brand\/hero-[a-z]+\.webp$/);
    assert.match(slide.src4k, /^\/images\/brand\/hero-[a-z]+-4k\.webp$/);
    assert.match(slide.thumb, /^\/images\/brand\/hero-[a-z]+-thumb\.webp$/);
  }
  assert.equal(
    new Set(slides.flatMap(({ src, src4k, thumb }) => [src, src4k, thumb])).size,
    12,
  );
});
