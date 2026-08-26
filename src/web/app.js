const $ = id => document.getElementById(id);
let allRows = [], marketItems = [], catalogItems = [];
const number = id => $(id).value === '' ? null : Number($(id).value);
const money = n => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

async function load() {
  $('status').textContent = '正在计算…';
  const ids = ['player', 'levelBonus', 'equipmentSuccess', 'communitySuccess', 'achievementSuccess', 'shrineSuccess', 'experienceBonus'];
  const q = new URLSearchParams(Object.fromEntries(ids.map(id => [id === 'player' ? 'playerLevel' : id, number(id) ?? 0])));
  q.set('feeRate', (number('fee') ?? 0) / 100);
  const response = await fetch(`/api/rankings?${q}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  allRows = data.rows;
  marketItems = data.marketItems ?? [];
  catalogItems = data.catalogItems ?? [];
  populateItems();
  renderMarket();
  $('status').textContent = data.timestamp
    ? `市场快照：${new Date(data.timestamp).toLocaleString()}；收到 ${data.marketItemCount} 种物品、${data.quoteCount} 条报价；目录 ${data.catalogSize} 件；可计算项目 ${data.rows.length} 个。`
    : data.message;
  render();
}

function populateItems() {
  const selected = $('item').value;
  const items = new Map();
  for (const item of catalogItems) items.set(item.itemHrid, item.itemName);
  $('item').innerHTML = '<option value="">全部装备</option>' + [...items].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
  $('item').value = items.has(selected) ? selected : '';
}

function render() {
  const selectedItem = $('item').value;
  let rows = allRows.filter(r => (!selectedItem || r.itemHrid === selectedItem) && r.totalExperience >= (number('minXp') ?? 0) &&
    r.volume >= (number('minVolume') ?? 0) && r.fromLevel >= (number('minLevel') ?? 0) && r.toLevel <= (number('maxLevel') ?? Infinity) &&
    (number('maxLoss') == null || r.profit >= -number('maxLoss')) && (number('maxCapital') == null || r.capitalRequired <= number('maxCapital')));
  const sort = $('sort').value;
  rows.sort((a, b) => sort === 'profit' ? b.profit - a.profit : sort === 'loss' ? Math.abs(Math.min(0, a.profit)) - Math.abs(Math.min(0, b.profit)) : sort === 'costPerExperience' ? a.costPerExperience - b.costPerExperience : b[sort] - a[sort]);
  $('rows').innerHTML = rows.map(r => `<tr data-id="${r.id}"><td>${r.itemName} +${r.fromLevel} → +${r.toLevel}</td><td>${(r.successRate * 100).toFixed(1)}%</td><td>${money(r.expectedAttempts)}</td><td>${money(r.totalExperience)}</td><td>${money(r.purchaseCost + r.materialCost)}</td><td>${money(r.preTaxProfit)}</td><td>${money(r.saleRevenue)}</td><td class="${r.profit >= 0 ? 'gain' : 'loss'}">${money(r.profit)}</td><td>${money(r.costPerExperience)}</td><td>${money(r.capitalRequired)}</td><td>${money(r.volume)}</td><td>${(r.spread * 100).toFixed(1)}%</td><td class="risk">${r.risks.join('、') || '—'}</td></tr>`).join('') || '<tr><td colspan="13">没有可计算的强化项目。可切换到“市场报价”查看已采集的原始行情，或放宽强化区间与筛选条件。</td></tr>';
  document.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.onclick = () => detail(allRows.find(r => r.id === tr.dataset.id)));
}

function renderMarket() {
  const query = $('marketSearch').value.trim().toLocaleLowerCase();
  const rows = marketItems.filter(q => `${q.itemName} ${q.itemHrid}`.toLocaleLowerCase().includes(query));
  $('marketSummary').textContent = `显示 ${rows.length} / ${marketItems.length} 条报价`;
  $('marketRows').innerHTML = rows.slice(0, 1000).map(q => `<tr><td>${q.itemName}<small>${q.itemHrid}</small></td><td>+${q.enhancementLevel}</td><td>${money(q.ask)}</td><td>${money(q.bid)}</td><td>${money(q.hourlyAverage)}</td><td>${money(q.hourlyVolume)}</td></tr>`).join('') || '<tr><td colspan="6">暂无市场报价</td></tr>';
}

function detail(r) {
  $('detail').hidden = false;
  $('detail').innerHTML = `<h2>${r.itemName} +${r.fromLevel} → +${r.toLevel}</h2><p><code>单层期望尝试 = 进入该层的期望物品数 ÷ 成功率；购买成本 = 初始卖一价 × 最终期望初始物品数；利润 = 目标买一价 − 购买成本 − 材料成本。</code></p><ul><li>初始物品：${money(r.purchaseCost)}</li><li>材料：${money(r.materialCost)}</li><li>税前卖出收入：${money(r.grossSaleRevenue)}</li><li>市场手续费：${money(r.marketFee)}</li><li>税后收入：${money(r.saleRevenue)}</li><li>税前利润：${money(r.preTaxProfit)}</li><li>公式版本：${r.formulaVersion}；游戏数据版本：${r.gameDataVersion}</li><li>快照：${r.snapshotTimestamp}</li></ul><table><thead><tr><th>目标层</th><th>成功率</th><th>期望尝试</th><th>获得经验</th><th>材料成本</th></tr></thead><tbody>${r.steps.map(s => `<tr><td>+${s.toLevel}</td><td>${(s.successRate * 100).toFixed(2)}%</td><td>${money(s.attempts)}</td><td>${money(s.experience)}</td><td>${money(s.materialCost)}</td></tr>`).join('')}</tbody></table>`;
  $('detail').scrollIntoView({ behavior: 'smooth' });
}

document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button === tab));
  document.querySelectorAll('.panel').forEach(panel => panel.hidden = panel.id !== tab.dataset.panel);
});
const profileIds = ['player', 'levelBonus', 'equipmentSuccess', 'communitySuccess', 'achievementSuccess', 'shrineSuccess', 'experienceBonus', 'fee'];
document.querySelectorAll('#projects input,#projects select').forEach(el => el.addEventListener('change', profileIds.includes(el.id) ? () => load().catch(show) : render));
$('marketSearch').addEventListener('input', renderMarket);
$('update').onclick = async () => { try { $('update').disabled = true; $('status').textContent = '正在获取官方小时快照…'; const r = await fetch('/api/market/update', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw Error(d.error); await load(); } catch (e) { show(e); } finally { $('update').disabled = false; } };
function show(e) { $('status').textContent = `错误：${e.message}`; }
load().catch(show);
