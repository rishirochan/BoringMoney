import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, summarizeTransactions, validateFilters, accountKey, transactionCurrency } from '../dist-electron/features/analytics/transactions.js';
const row = (date, amount, extra = {}) => ({ documentId: 'a', date, amount, description: 'Groceries', type: 'purchase', rawLine: '', ...extra });

test('inclusive ranges, account/search/category and pending filters apply to the same rows', () => {
  const rows = [row('2026-01-01', -10), row('2026-01-31', -20), row('2026-02-01', -30), row('2026-01-15', -40, {pending:true})];
  assert.equal(filterTransactions(rows, {from:'2026-01-01',to:'2026-01-31',query:'GROCER'}).length, 2);
  assert.equal(filterTransactions(rows, {pending:'only'}).length, 1);
  assert.equal(filterTransactions(rows, {pending:'include',account:'a',category:'Uncategorized'}).length, 4);
  assert.throws(() => validateFilters({from:'2026-02-30'}), /valid date/);
  assert.throws(() => validateFilters({from:'2026-02-01',to:'2026-01-01'}), /start date/);
  assert.throws(() => validateFilters({pending:'banana'}), /pending/);
  assert.throws(() => validateFilters({query:42}), /filter/);
});

test('totals use minor units and spending excludes known transfers without labelling inflows income', () => {
  const summary = summarizeTransactions([row('2026-01-01',-.1),row('2026-01-02',-.2),row('2026-01-03',100),row('2026-02-01',-20,{isTransfer:true})]);
  assert.equal(summary.moneyOut,20.3);
  assert.equal(summary.net,79.7);
  assert.equal(summary.spending,.3);
  assert.equal(summary.categories[0].amount,.3);
  assert.equal(summary.transferCount,1);
  assert.deepEqual(summary.monthly.map(m=>m.month),['2026-01','2026-02']);
  assert.throws(() => summarizeTransactions([row('2026-01-01',1),row('2026-01-02',2,{currency:'EUR'})]), /currency/);
  assert.equal(transactionCurrency(row('2026-01-01',1,{source:'plaid'})), 'Unknown');
  assert.equal(accountKey(row('2026-01-01',1,{accountId:'checking'}),[]),'plaid:checking');
});


test('unknown currencies stay separate and higher precision amounts survive totals', () => {
  const a = row('2026-01-01',-1.234,{currency:'BHD'});
  const b = row('2026-01-02',-2.345,{currency:'BHD'});
  assert.equal(summarizeTransactions([a,b]).moneyOut,3.579);
  assert.equal(summarizeTransactions([a,b]).categories[0].amount,3.579);
  assert.equal(transactionCurrency(row('2026-01-01',1)), 'Unknown');
  assert.throws(() => summarizeTransactions([row('2026-01-01',1), row('2026-01-01',1,{currency:'USD'})]), /currency/);
});
