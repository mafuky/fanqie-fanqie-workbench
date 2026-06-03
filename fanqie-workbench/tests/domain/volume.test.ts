import { describe, expect, it } from 'vitest'
import {
  chineseNumeralToInt, parseVolumeFileName, parseVolumeChapterRange, findVolumeEndingAt,
} from '../../src/domain/volume'

describe('chineseNumeralToInt', () => {
  it('parses 一..十 and compound forms', () => {
    expect(chineseNumeralToInt('一')).toBe(1)
    expect(chineseNumeralToInt('十')).toBe(10)
    expect(chineseNumeralToInt('十二')).toBe(12)
    expect(chineseNumeralToInt('二十')).toBe(20)
    expect(chineseNumeralToInt('二十一')).toBe(21)
  })
  it('accepts arabic and rejects junk', () => {
    expect(chineseNumeralToInt('3')).toBe(3)
    expect(chineseNumeralToInt('零零')).toBeNull()
    expect(chineseNumeralToInt('')).toBeNull()
  })
})

describe('parseVolumeFileName', () => {
  it('extracts the volume number from 卷纲_第X卷.md', () => {
    expect(parseVolumeFileName('卷纲_第一卷.md')).toBe(1)
    expect(parseVolumeFileName('卷纲_第十二卷.md')).toBe(12)
  })
  it('returns null for non-volume files', () => {
    expect(parseVolumeFileName('大纲.md')).toBeNull()
    expect(parseVolumeFileName('细纲_第001章.md')).toBeNull()
  })
})

describe('parseVolumeChapterRange', () => {
  it('reads 章节范围 line, tolerant of full/half-width colon and spaces', () => {
    expect(parseVolumeChapterRange('# 第一卷\n章节范围:第1-8章\n## 本卷目标')).toEqual({ start: 1, end: 8 })
    expect(parseVolumeChapterRange('章节范围： 第 9 — 18 章')).toEqual({ start: 9, end: 18 })
  })
  it('ignores other chapter mentions (爽点节奏: 第1-2章) when no 章节范围 line', () => {
    expect(parseVolumeChapterRange('爽点节奏\n- 第1-2章:开篇')).toBeNull()
  })
})

describe('findVolumeEndingAt', () => {
  const vols = [
    { volumeNumber: 1, start: 1, end: 8 },
    { volumeNumber: 2, start: 9, end: 18 },
  ]
  it('returns the volume when N is its last chapter', () => {
    expect(findVolumeEndingAt(8, vols)).toEqual({ volumeNumber: 1, start: 1, end: 8 })
  })
  it('returns null when N is mid-volume', () => {
    expect(findVolumeEndingAt(5, vols)).toBeNull()
  })
  it('returns null when N falls in no / overlapping ranges', () => {
    expect(findVolumeEndingAt(99, vols)).toBeNull()
    expect(findVolumeEndingAt(8, [...vols, { volumeNumber: 9, start: 8, end: 12 }])).toBeNull()
  })
})
