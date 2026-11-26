import test from 'node:test';
import assert from 'node:assert/strict';
import {readingWordSegments} from '../dist/language-pairs.js';
import {normalizeWord,wordKey} from '../dist/learning-core.js';

test('reader keeps UTF-16 offsets and word boundaries for tagged Japanese and borrowed Latin text',()=>{
  const text='📚私は本を読む。明日も読む。 Jean-Luc';
  const result=[...readingWordSegments(text,'ja-JP')];
  assert.deepEqual(result.map(x=>x.word),['私','は','本','を','読む','明日','も','読む','Jean-Luc']);
  assert.deepEqual(result.map(x=>x.offset),[2,3,4,5,6,9,11,12,16]);
  for(const {word,offset} of result)assert.equal(text.slice(offset,offset+word.length),word);
});

test('legacy hyphen, apostrophe, accent and punctuation boundaries stay intact for other languages',()=>{
  const result=[...readingWordSegments("📚 Ça, l’été! At-most. 41.",'fr')];
  assert.deepEqual(result,[{word:'Ça',offset:3},{word:'l’été',offset:7},{word:'At-most',offset:14}]);
  const large='あ'.repeat(4500);
  assert.deepEqual([...readingWordSegments(large,'ja')],[{word:large,offset:0}]);
});

test('discretionary hyphens stay in source spans but not dictionary or saved word keys',()=>{
  const text='lan\u00adtern. co-operate / re\u00ad-enter';
  assert.deepEqual([...readingWordSegments(text,'en')],[
    {word:'lan\u00adtern',offset:0},{word:'co-operate',offset:10},
    {word:'re',offset:23},{word:'enter',offset:27}
  ]);
  assert.equal(wordKey('lan\u00adtern','en'),wordKey('lantern','en'));
  assert.equal(normalizeWord('co-operate','en'),'co-operate');
});
