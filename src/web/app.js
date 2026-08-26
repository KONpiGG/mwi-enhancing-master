const $ = id => document.getElementById(id);
let allRows = [], marketItems = [], catalogItems = [], presetOptions = [];
const number = id => $(id).value === '' ? null : Number($(id).value);
const money = n => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const icon = hrid => `<svg class="item-icon" aria-hidden="true"><use href="items.svg#${hrid.split('/').at(-1)}"></use></svg>`;

async function load() {
  $('status').textContent = '正在计算…';
  const q = new URLSearchParams({ playerLevel: number('player') ?? 0 });
  const equipment = {}; document.querySelectorAll('.slot-select').forEach(select => { if (select.value) equipment[select.dataset.slot] = { hrid: select.value, enhanceLevel: Number($(`level-${select.dataset.slot}`).value) }; });
  q.set('equipment', JSON.stringify(equipment)); q.set('teas', [...document.querySelectorAll('[name=tea]:checked')].map(x => x.value).join(','));
  q.set('feeRate', (number('fee') ?? 0) / 100);
  const response = await fetch(`/api/rankings?${q}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  allRows = data.rows;
  marketItems = data.marketItems ?? [];
  catalogItems = data.catalogItems ?? [];
  presetOptions = data.presetOptions ?? presetOptions; populatePreset();
  populateItems();
  renderMarket();
  $('status').textContent = data.timestamp
    ? `市场快照：${new Date(data.timestamp).toLocaleString()}；收到 ${data.marketItemCount} 种物品、${data.quoteCount} 条报价；目录 ${data.catalogSize} 件；可计算项目 ${data.rows.length} 个。`
    : data.message;
  if (data.profile) $('buffSummary').textContent = `当前推导：有效强化等级 ${data.profile.playerLevel}｜成功率加成 ${(data.profile.success*100).toFixed(2)}%｜跳级率 ${(data.profile.blessed*100).toFixed(2)}%｜经验加成 ${(data.profile.experience*100).toFixed(2)}%｜装备/饮品速度 ${(data.profile.speed*100).toFixed(2)}%`;
  render();
}

function populatePreset() {
  if ($('equipmentSlots').children.length || !presetOptions.length) return;
  const labels = {tool:'强化器',charm:'强化护符',hands:'手部',body:'上衣',legs:'下装',back:'背部',neck:'项链'};
  $('equipmentSlots').innerHTML = Object.entries(labels).map(([slot,label]) => `<label>${label}<span><select class="slot-select" data-slot="${slot}"><option value="">未装备</option>${presetOptions.filter(x=>x.slot===slot).map(x=>`<option value="${x.hrid}">${x.name}</option>`).join('')}</select><select id="level-${slot}" class="enhance-level">${Array.from({length:21},(_,i)=>`<option value="${i}">+${i}</option>`).join('')}</select></span></label>`).join('');
  document.querySelectorAll('.slot-select,.enhance-level').forEach(el => el.addEventListener('change', () => load().catch(show)));
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
    r.volume >= (number('minVolume') ?? 0) &&
    (number('maxLoss') == null || r.profit >= -number('maxLoss')) && (number('maxCapital') == null || r.capitalRequired <= number('maxCapital')));
  const sort = $('sort').value;
  rows.sort((a, b) => sort === 'profit' ? b.profit - a.profit : sort === 'loss' ? Math.abs(Math.min(0, a.profit)) - Math.abs(Math.min(0, b.profit)) : sort === 'costPerExperience' ? a.costPerExperience - b.costPerExperience : b[sort] - a[sort]);
  $('rows').innerHTML = rows.map(r => `<tr data-id="${r.id}"><td class="item-cell">${icon(r.itemHrid)}<span>${r.itemName} +${r.fromLevel} → +${r.toLevel}</span></td><td>${(r.bestStrategy.steps.at(-1).successRate * 100).toFixed(1)}%</td><td>${money(r.expectedAttempts)}</td><td>${money(r.totalExperience)}</td><td>${money(r.capitalRequired)}</td><td>${money(r.grossSaleRevenue-r.capitalRequired)}</td><td>${money(r.saleRevenue)}</td><td class="${r.profit >= 0 ? 'gain' : 'loss'}">${money(r.profit)}</td><td>${money(r.costPerExperience)}</td><td>${money(r.capitalRequired)}</td><td>${money(r.volume)}</td><td>${(r.spread * 100).toFixed(1)}%</td><td class="risk">${r.risks.join('、') || '—'}</td></tr>`).join('') || '<tr><td colspan="13">没有可计算的强化项目。可切换到“市场报价”查看已采集的原始行情，或放宽强化区间与筛选条件。</td></tr>';
  document.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.onclick = () => detail(allRows.find(r => r.id === tr.dataset.id)));
}

function renderMarket() {
  const query = $('marketSearch').value.trim().toLocaleLowerCase();
  const rows = marketItems.filter(q => `${q.itemName} ${q.itemHrid}`.toLocaleLowerCase().includes(query));
  $('marketSummary').textContent = `显示 ${rows.length} / ${marketItems.length} 条报价`;
  $('marketRows').innerHTML = rows.slice(0, 1000).map(q => `<tr><td class="item-cell">${icon(q.itemHrid)}<span>${q.itemName}<small>${q.itemHrid}</small></span></td><td>+${q.enhancementLevel}</td><td>${money(q.ask)}</td><td>${money(q.bid)}</td><td>${money(q.hourlyAverage)}</td><td>${money(q.hourlyVolume)}</td></tr>`).join('') || '<tr><td colspan="6">暂无市场报价</td></tr>';
}

function detail(r) {
  $('detail').hidden = false;
  $('detail').innerHTML = `<h2>${r.itemName} +${r.fromLevel} → +${r.toLevel}</h2><p><code>马尔可夫基本矩阵计算每层期望访问次数；本体只购买一件。最佳策略：${r.bestStrategy.protectLevel===r.toLevel?'不保护':`从 +${r.bestStrategy.protectLevel} 保护`}。</code></p><ul><li>初始物品：${money(r.purchaseCost)}</li><li>材料：${money(r.materialCost)}</li><li>保护：${money(r.protectionCost)}（${r.bestStrategy.protectionItemHrid ?? '无'}）</li><li>税前卖出收入：${money(r.grossSaleRevenue)}</li><li>市场手续费：${money(r.marketFee)}</li><li>税后收入：${money(r.saleRevenue)}</li><li>公式版本：${r.formulaVersion}；游戏数据版本：${r.gameDataVersion}</li><li>快照：${r.snapshotTimestamp}</li></ul><table><thead><tr><th>保护阈值</th><th>期望次数</th><th>保护数量</th><th>现金成本</th><th>预计利润</th></tr></thead><tbody>${r.allStrategies.map(s => `<tr><td>${s.protectLevel===r.toLevel?'不保护':`+${s.protectLevel}`}</td><td>${money(s.expectedActions)}</td><td>${money(s.expectedProtections)}</td><td>${money(s.cashCost)}</td><td>${money(s.expectedProfit)}</td></tr>`).join('')}</tbody></table>`;
  $('detail').scrollIntoView({ behavior: 'smooth' });
}

document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button === tab));
  document.querySelectorAll('.panel').forEach(panel => panel.hidden = panel.id !== tab.dataset.panel);
});
const profileIds = ['player', 'fee'];
document.querySelectorAll('#projects input,#projects select').forEach(el => el.addEventListener('change', profileIds.includes(el.id) ? () => load().catch(show) : render));
$('marketSearch').addEventListener('input', renderMarket);
document.querySelectorAll('[name=tea]').forEach(el => el.addEventListener('change', () => load().catch(show)));
$('update').onclick = async () => { try { $('update').disabled = true; $('status').textContent = '正在获取官方小时快照…'; const r = await fetch('/api/market/update', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw Error(d.error); await load(); } catch (e) { show(e); } finally { $('update').disabled = false; } };
function show(e) { $('status').textContent = `错误：${e.message}`; }
load().catch(show);
