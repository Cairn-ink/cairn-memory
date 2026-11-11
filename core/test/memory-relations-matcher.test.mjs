import test from 'node:test';
import assert from 'node:assert/strict';
import { sameThreadScore, SAME_THREAD_THRESHOLD } from '../memory-relations.mjs';
import { memoryThreadFixture } from '../testing/memory-thread-fixture.mjs';
const positive=[
 ['I like coffee.','I stopped drinking coffee because it upsets my stomach.'],
 ['I like pancakes.','I stopped eating pancakes.'],
 ['I love chocolate.','I avoid chocolate.'],
 ['I enjoy swimming.','I stopped swimming.'],
 ['I like tea.','I stopped drinking tea.'],
 ['My breakfast is oats.','My breakfast is eggs.'],
 ['我很喜歡吃蛋餅，幾乎每天早餐都吃。','我現在不吃蛋餅了，因為看到新聞說那家店用地溝油。'],
 ['我喜歡咖啡。','我不喝咖啡了。'],
 ['我喜歡游泳。','我不再游泳了。'],
 ['我的早餐是燕麥。','我的早餐改成雞蛋。'],
 ['我喜歡吃巧克力。','我現在不吃巧克力了。'],
 ['小明是我的同事。','小明是我的主管。'],
];
const negative=[
 ['My friend Alex is my manager.','My friend Alex is allergic to peanuts.'],
 ['我的朋友小明是我的同事。','我的朋友小明是素食者。'],
 ['My sister is my manager.','My sister is allergic to peanuts.'],
 ['我的妹妹是我的同事。','我的妹妹是素食者。'],
 ['我喜歡東西。','我不喜歡東西了。'],
 ['Alex is my manager.','Alex is allergic to peanuts.'],
 ['I like coffee.','My brother likes coffee.'],
 ['I like coffee.','I like pancakes.'],
 ['I like food.','I stopped eating food.'],
 ['I like good things.','I avoid good things.'],
 ['I like coffee.','I like buying coffee.'],
 ['小明是我的同事。','小明是素食者。'],
 ['我喜歡蛋餅。','我妹妹喜歡蛋餅。'],
 ['我喜歡游泳。','我的貓叫小白。'],
 ['我喜歡咖啡。','我不吃蛋餅了。'],
 ['我的早餐是燕麥。','我的晚餐是燕麥。'],
 ['我喜歡吃蛋餅。','我喜歡買蛋餅。'],
];
for(const [expected,pairs] of [[true,positive],[false,negative]])for(const [left,right] of pairs)test(`ordinary pair ${expected}: ${left} / ${right}`,()=>{
 assert.equal(sameThreadScore(left,right)>=SAME_THREAD_THRESHOLD,expected);
 assert.equal(sameThreadScore(right,left)>=SAME_THREAD_THRESHOLD,expected);
});
for(const [left,right] of positive.slice(0,2).concat([positive[6]]))test('capture links an ordinary preference and excludes unrelated facts: '+left,async t=>{
 const f=memoryThreadFixture(t);
 await f.capture('I swim twice a week.');await f.capture('My cat is named Willow.');
 await f.capture(left);await f.capture(right);
 const result=await f.read({query:left,maxItems:1});
 assert.deepEqual(result.metered.items.map(item=>item.body).sort(),[left,right].map(s=>s.normalize('NFKC')).sort());
});
