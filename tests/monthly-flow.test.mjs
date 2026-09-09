import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, summarizeTransactions } from '../dist-electron/features/analytics/transactions.js';

test('hover breakdowns match each filtered monthly bar, including credits, transfers and precision', () => {
  const row = (date, amount, category, extra = {}) => ({
    documentId: 'checking', date, amount, category, currency: 'BHD',
    description: 'Activity', type: 'purchase', rawLine: '', ...extra,
  });
  const rows = [
    row('2026-01-02', -1.234, 'FOOD_AND_DRINK'),
    row('2026-01-03', -2.345, 'FOOD_AND_DRINK'),
    row('2026-01-04', -10, 'TRANSFER', { isTransfer: true }),
    row('2026-01-05', 20, 'INCOME'),
    row('2026-01-06', 1.111, undefined, { isTransfer: true }),
    row('2026-01-07', 0, 'ADJUSTMENT'),
    row('2026-02-01', -5, 'SHOPPING'),
    row('2026-01-08', -100, 'SHOPPING', { pending: true }),
  ];
  const summary = summarizeTransactions(filterTransactions(rows, { from: '2026-01-01', to: '2026-01-31' }));
  assert.equal(summary.monthly.length, 1);
  const month = summary.monthly[0];
  assert.equal(month.moneyIn, 21.111);
  assert.equal(month.moneyOut, 13.579);
  assert.equal(month.net, 7.532);
  assert.deepEqual(month.outgoingCategories, [
    { label: 'Transfers', amount: 10, count: 1 },
    { label: 'Food And Drink', amount: 3.579, count: 2 },
  ]);
  assert.deepEqual(month.incomingCategories, [
    { label: 'Income', amount: 20, count: 1 },
    { label: 'Transfers', amount: 1.111, count: 1 },
  ]);
  for (const [categories, total] of [[month.incomingCategories, month.moneyIn], [month.outgoingCategories, month.moneyOut]]) {
    assert.equal(categories.reduce((sum, category) => sum + Math.round(category.amount * 1000), 0), Math.round(total * 1000));
  }
  assert.equal(summary.spending, 3.579);
  assert.deepEqual(summarizeTransactions([row('2026-02-01', -5, 'SHOPPING')]).monthly[0].incomingCategories, []);
});
