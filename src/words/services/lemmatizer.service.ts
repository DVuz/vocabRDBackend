import { Injectable } from '@nestjs/common';

/**
 * Single Responsibility: chỉ xử lý rule-based lemmatization
 * (tách khỏi WordService để dễ test độc lập)
 */
@Injectable()
export class LemmatizerService {
  guess(word: string): string {
    const w = word.toLowerCase().trim();

    const irregulars: Record<string, string> = {
      children: 'child', men: 'man', women: 'woman',
      teeth: 'tooth', feet: 'foot', mice: 'mouse',
      geese: 'goose', oxen: 'ox', criteria: 'criterion',
      phenomena: 'phenomenon', cacti: 'cactus',
    };
    if (irregulars[w]) return irregulars[w];

    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'fe';
    if (/(?:ss|x|z|ch|sh)es$/.test(w) && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1);

    if (w.endsWith('ing') && w.length > 5) {
      const stem = w.slice(0, -3);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) return stem.slice(0, -1);
      return stem + 'e';
    }

    if (w.endsWith('ed') && w.length > 4) {
      const stem = w.slice(0, -2);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) return stem.slice(0, -1);
      if (w.endsWith('ied')) return w.slice(0, -3) + 'y';
      return stem + 'e';
    }

    return w;
  }
}
